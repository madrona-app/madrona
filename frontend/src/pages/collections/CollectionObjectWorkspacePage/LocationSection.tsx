import { useRef, useEffect, useCallback, useState } from 'react';
import { MapPin, Package, ArrowRightLeft } from 'lucide-react';
import { WorkspaceSection, EditableField, EditableSelect, EditableCheckbox } from '../../../components/workspace';
import { EditableLocationPicker } from '../../../components/collections/LocationPickerModal';
import type { CollectionObject } from '../../../lib/schemas';
import type { FormData } from './types';

/** Small inline barcode rendered via bwip-js. */
function InlineBarcode({ value }: { value: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ok, setOk] = useState(false);

  const render = useCallback(async () => {
    if (!canvasRef.current || !value) return;
    try {
      const bwipjs = (await import('bwip-js/browser')).default;
      bwipjs.toCanvas(canvasRef.current, {
        bcid: 'qrcode',
        text: value,
        scale: 3,
        width: 25,
        height: 25,
      });
      setOk(true);
    } catch {
      setOk(false);
    }
  }, [value]);

  useEffect(() => { render(); }, [render]);

  if (!value) return null;
  return <canvas ref={canvasRef} className={`mt-1 ${ok ? '' : 'hidden'}`} />;
}

interface LocationSectionProps {
  orgId: string;
  object: CollectionObject;
  formData: FormData | null;
  isEditing: boolean;
  isCreateMode: boolean;
  updateField: <K extends keyof FormData>(field: K, value: FormData[K]) => void;
  handleFieldBlur: () => void;
  onMovementClick: () => void;
  sectionHint: string;
  isEmpty?: boolean;
  expandedSections: Record<string, boolean>;
  toggleSection: (sectionId: string) => void;
  sectionRefs: React.MutableRefObject<Record<string, HTMLDivElement | null>>;
  getSectionOrder: (sectionId: string) => number;
}

export function LocationSection({
  orgId,
  object,
  formData,
  isEditing,
  isCreateMode,
  updateField,
  handleFieldBlur,
  onMovementClick,
  sectionHint,
  isEmpty,
  expandedSections,
  toggleSection,
  sectionRefs,
  getSectionOrder,
}: LocationSectionProps) {
  if (isCreateMode) return null;

  const isMultiPart = (object?.parts?.length || 0) > 1;

  return (
    <WorkspaceSection
      id="location"
      title="Location"
      icon={<MapPin size={18} />}
      hint={sectionHint}
      isEmpty={isEmpty}
      isExpanded={expandedSections.location}
      onToggle={() => toggleSection('location')}
      isEditing={isEditing}
      sectionRef={(el) => { sectionRefs.current['location'] = el; }}
      order={getSectionOrder('location')}
    >
      {isMultiPart ? (
        <div className="space-y-4">
          {/* Part locations summary */}
          <div className="space-y-2">
            {object.parts!.map((part) => {
              const partLabel = part.part_number ? `.${part.part_number}` : '';
              const name = part.name ? ` ${part.name}` : '';
              const locDisplay = part.current_location_path || part.current_location_name;

              return (
                <div
                  key={part.part_id}
                  className="flex items-center justify-between py-2 px-3 bg-stone/20 rounded-lg"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Package size={14} className="text-archive flex-shrink-0" />
                    <span className="text-sm font-medium text-ink truncate">
                      {object?.object_number}{partLabel}{name}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-sm text-archive flex-shrink-0 ml-3">
                    <MapPin size={12} />
                    {locDisplay || <span className="italic">No location</span>}
                  </div>
                </div>
              );
            })}
          </div>

          <p className="text-xs text-archive">
            This object has multiple parts. Update locations and view movement history in the{' '}
            <button
              onClick={() => toggleSection('parts')}
              className="text-bark hover:text-copper-dark underline underline-offset-2"
            >
              Parts
            </button>{' '}
            section.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Current Location — changed via Record Movement to preserve history */}
            <div>
              <dt className="text-sm font-medium text-archive mb-1">Current Location</dt>
              <dd className="text-ink flex items-center gap-2">
                {object?.current_location ? (
                  <>
                    <MapPin size={14} className="text-archive flex-shrink-0" />
                    <span>{object.current_location.path || object.current_location.name}</span>
                  </>
                ) : (
                  <span className="text-archive italic">Not set</span>
                )}
                <button
                  type="button"
                  onClick={onMovementClick}
                  className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-bark border border-bark/30 rounded-lg hover:bg-bark/10 transition-colors"
                >
                  <ArrowRightLeft size={12} />
                  {object?.current_location ? 'Move' : 'Set Location'}
                </button>
              </dd>
            </div>

            {/* Home Location - Editable directly (no movement history needed) */}
            <EditableLocationPicker
              label="Home Location"
              organizationId={orgId}
              value={isEditing ? (formData?.home_location_id || null) : (object?.home_location_id || null)}
              displayValue={object?.home_location?.path || object?.home_location?.name}
              onChange={(v) => updateField('home_location_id', v)}
              isEditing={isEditing}
              emptyText="Not set"
            />
          </div>

          {/* Location details */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <EditableSelect
              label="Location Fitness"
              value={isEditing ? (formData?.current_location_fitness || '') : (object?.current_location_fitness || '')}
              isEditing={isEditing}
              onChange={(v) => updateField('current_location_fitness', v)}
              options={[
                { value: 'suitable', label: 'Suitable' },
                { value: 'temporary', label: 'Temporary' },
                { value: 'unsuitable', label: 'Unsuitable' },
              ]}
              placeholder="Not assessed"
            />
            <EditableField
              label="Location Note"
              value={isEditing ? (formData?.current_location_note || '') : (object?.current_location_note || '')}
              isEditing={isEditing}
              onChange={(v) => updateField('current_location_note', v)}
              onSave={handleFieldBlur}
              placeholder="No note"
            />
          </div>

          {/* Inventory */}
          <div className="pt-4 border-t border-lichen">
            <h4 className="text-sm font-medium text-ink mb-3">Inventory</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <div className="text-xs font-medium text-archive mb-1">QR Code</div>
                <InlineBarcode value={object?.object_id || ''} />
              </div>
              <EditableCheckbox
                value={isEditing ? (formData?.is_discoverable ?? false) : (object?.is_discoverable ?? false)}
                label="Publicly Discoverable"
                isEditing={isEditing}
                onChange={(v) => updateField('is_discoverable', v)}
                description="Make this object visible in public search results."
              />
            </div>
          </div>

          <p className="text-xs text-archive">
            Movement history is tracked in the{' '}
            <button
              onClick={() => toggleSection('parts')}
              className="text-bark hover:text-copper-dark underline underline-offset-2"
            >
              Parts
            </button>{' '}
            section.
          </p>
        </div>
      )}
    </WorkspaceSection>
  );
}
