/**
 * LocationPickerModal - Modal wrapper for PointPicker.
 *
 * Provides a full-screen modal for selecting a location on a map.
 * Used in forms where coordinate selection should be in a dedicated dialog.
 */

import { useState, useCallback } from 'react';
import { X, MapPin, Check } from 'lucide-react';
import PointPicker from './PointPicker';
import type { Coordinates } from './PointPicker';
import { ModalPortal } from '../ModalPortal';

export interface LocationPickerModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback when modal is closed */
  onClose: () => void;
  /** Callback when location is selected */
  onSelect: (coords: Coordinates | null) => void;
  /** Initial coordinates (if editing existing location) */
  initialValue?: Coordinates | null;
  /** Modal title */
  title?: string;
  /** Description text */
  description?: string;
}

export default function LocationPickerModal({
  isOpen,
  onClose,
  onSelect,
  initialValue = null,
  title = 'Select Location',
  description = 'Click on the map to place a marker, or drag the marker to adjust.',
}: LocationPickerModalProps) {
  const [selectedLocation, setSelectedLocation] = useState<Coordinates | null>(initialValue);

  const handleConfirm = useCallback(() => {
    onSelect(selectedLocation);
    onClose();
  }, [selectedLocation, onSelect, onClose]);

  const handleCancel = useCallback(() => {
    setSelectedLocation(initialValue);
    onClose();
  }, [initialValue, onClose]);

  if (!isOpen) return null;

  return (
    <ModalPortal>
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-ink/50 transition-opacity"
        onClick={handleCancel}
      />

      {/* Modal */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative w-full max-w-3xl bg-parchment rounded-lg shadow-xl">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-lichen">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-semantic-info/10 rounded-lg">
                <MapPin className="w-5 h-5 text-bark" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-ink">{title}</h2>
                <p className="text-sm text-archive">{description}</p>
              </div>
            </div>
            <button
              onClick={handleCancel}
              aria-label="Close"
              className="p-2 text-archive hover:text-accessible-gray rounded-lg hover:bg-lichen"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Map */}
          <div className="p-6">
            <PointPicker
              value={selectedLocation}
              onChange={setSelectedLocation}
              height={400}
              showCoordinates={true}
              draggable={true}
            />
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-6 py-4 border-t border-lichen bg-lichen/30 rounded-b-lg">
            <div className="text-sm text-archive">
              {selectedLocation ? (
                <span>
                  Selected: {selectedLocation.latitude.toFixed(6)}, {selectedLocation.longitude.toFixed(6)}
                </span>
              ) : (
                <span>No location selected</span>
              )}
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleCancel}
                className="px-4 py-2 text-sm font-medium text-ink bg-parchment border border-lichen rounded-lg hover:bg-stone/30"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-parchment bg-bark rounded-lg hover:bg-bark"
              >
                <Check className="w-4 h-4" />
                Confirm Location
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
