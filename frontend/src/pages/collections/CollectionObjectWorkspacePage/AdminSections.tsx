import { Link } from 'react-router-dom';
import { Shield, FileText, DollarSign, Package, Thermometer, Plus } from 'lucide-react';
import { formatCurrency } from '@/lib/formatters';
import { WorkspaceSection, EditableField, EditableSelect } from '../../../components/workspace';
import { NameListField } from '../../../components/collections/ObjectFieldComponents';
import { ConditionReportLinker } from '../../../components/collections/ConditionReportLinker';
import { ObjectRightsManager } from '../../../components/collections/ObjectRightsManager';
import { ObjectAcquisitionSelector } from '../../../components/collections/AcquisitionObjectLinker';
import { RelatedProcedures } from '../../../components/collections/RelatedProcedures';
import { ObjectPartsManager } from '../../../components/collections/ObjectPartsManager';
import { NagpraManager } from '../../../components/collections/NagpraManager';
import type { CollectionObject, Valuation } from '../../../lib/schemas';
import type { FormData } from './types';

interface AdminSectionBaseProps {
  orgId: string;
  objectId?: string;
  object: CollectionObject | null;
  isEditing: boolean;
  isCreateMode: boolean;
  expandedSections: Record<string, boolean>;
  toggleSection: (sectionId: string) => void;
  sectionRefs: React.MutableRefObject<Record<string, HTMLDivElement | null>>;
  getSectionOrder: (sectionId: string) => number;
  isEmpty?: boolean;
  sectionSummaries?: Record<string, string | undefined>;
  isRestricted: (field: string) => boolean;
}

// Condition Section
interface ConditionSectionProps extends AdminSectionBaseProps {
  formData: FormData | null;
  updateField: <K extends keyof FormData>(field: K, value: FormData[K]) => void;
  handleFieldBlur: () => void;
}

export function ConditionSection({
  orgId,
  objectId,
  object,
  formData,
  isEditing,
  updateField,
  handleFieldBlur,
  expandedSections,
  toggleSection,
  sectionRefs,
  getSectionOrder,
  isEmpty,
  sectionSummaries,
}: ConditionSectionProps) {
  return (
    <WorkspaceSection
      id="condition"
      title="Condition"
      icon={<Shield size={18} />}
      hint={sectionSummaries?.condition}
      isEmpty={isEmpty}
      isExpanded={expandedSections.condition}
      onToggle={() => toggleSection('condition')}
      isEditing={isEditing}
      sectionRef={(el) => { sectionRefs.current['condition'] = el; }}
      order={getSectionOrder('condition')}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <EditableSelect
            label="Completeness"
            value={isEditing ? (formData?.completeness || '') : (object?.completeness || '')}
            isEditing={isEditing}
            onChange={(v) => updateField('completeness', v)}
            options={[
              { value: 'complete', label: 'Complete' },
              { value: 'incomplete', label: 'Incomplete' },
              { value: 'fragment', label: 'Fragment' },
              { value: 'unknown', label: 'Unknown' },
            ]}
            placeholder="Select..."
          />
          <EditableSelect
            label="Conservation Priority"
            value={isEditing ? (formData?.conservation_priority || '') : (object?.conservation_priority || '')}
            isEditing={isEditing}
            onChange={(v) => updateField('conservation_priority', v)}
            options={[
              { value: 'urgent', label: 'Urgent' },
              { value: 'high', label: 'High' },
              { value: 'medium', label: 'Medium' },
              { value: 'low', label: 'Low' },
              { value: 'none', label: 'None Required' },
            ]}
            placeholder="Select..."
          />
          <EditableSelect
            label="Salvage Priority"
            value={isEditing ? (formData?.salvage_priority || '') : (object?.salvage_priority || '')}
            isEditing={isEditing}
            onChange={(v) => updateField('salvage_priority', v)}
            options={[
              { value: 'critical', label: 'Critical' },
              { value: 'high', label: 'High' },
              { value: 'medium', label: 'Medium' },
              { value: 'low', label: 'Low' },
            ]}
            placeholder="Select..."
          />
        </div>
        <EditableField
          label="Completeness Note"
          value={isEditing ? (formData?.completeness_note || '') : (object?.completeness_note || '')}
          isEditing={isEditing}
          onChange={(v) => updateField('completeness_note', v)}
          onSave={handleFieldBlur}
          placeholder="Details about missing parts or components..."
        />
        <EditableField
          label="Condition Note"
          value={isEditing ? (formData?.condition_note || '') : (object?.condition_note || '')}
          isEditing={isEditing}
          onChange={(v) => updateField('condition_note', v)}
          onSave={handleFieldBlur}
          multiline
          rows={2}
          placeholder="Current condition observations..."
        />
        <div className="grid grid-cols-2 gap-4">
          <EditableField
            label="Next Condition Check"
            value={isEditing ? (formData?.next_condition_check_date || '') : (object?.next_condition_check_date || '')}
            isEditing={isEditing}
            onChange={(v) => updateField('next_condition_check_date', v)}
            onSave={handleFieldBlur}
            type="date"
          />
        </div>
        <EditableField
          label="Handling Requirements"
          value={isEditing ? (formData?.handling_requirements || '') : (object?.handling_requirements || '')}
          isEditing={isEditing}
          onChange={(v) => updateField('handling_requirements', v)}
          onSave={handleFieldBlur}
          multiline
          rows={2}
          placeholder="Special handling instructions..."
        />

        {/* Hazards */}
        <div className="pt-4 border-t border-lichen">
          <NameListField
            label="Hazards"
            items={isEditing ? (formData?.hazards || []) : (object?.hazards || [])}
            isEditing={isEditing}
            onChange={(items) => updateField('hazards', items)}
            onSave={handleFieldBlur}
            nameKey="type"
            placeholder="Hazard type (e.g., chemical, biological)..."
            secondaryFields={[
              { key: 'description', label: 'Description', placeholder: 'Description of hazard...' },
            ]}
          />
        </div>

        {/* Environmental Requirements */}
        {(isEditing || object?.environmental_requirements) && (
          <div className="pt-4 border-t border-lichen">
            <h4 className="text-sm font-medium text-ink mb-3 flex items-center gap-1.5">
              <Thermometer size={14} className="text-semantic-info" />
              Environmental Requirements
            </h4>
            {(() => {
              const env = isEditing
                ? (formData?.environmental_requirements || {})
                : (object?.environmental_requirements || {});
              const updateEnv = (key: string, value: any) => {
                updateField('environmental_requirements', {
                  ...(formData?.environmental_requirements || {}),
                  [key]: value,
                });
              };
              return (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <EditableField
                    label="Temperature Min (°C)"
                    value={env.temperature_min?.toString() || ''}
                    isEditing={isEditing}
                    onChange={(v) => updateEnv('temperature_min', v ? parseFloat(v) : null)}
                    onSave={handleFieldBlur}
                    type="number"
                    placeholder="e.g., 18"
                  />
                  <EditableField
                    label="Temperature Max (°C)"
                    value={env.temperature_max?.toString() || ''}
                    isEditing={isEditing}
                    onChange={(v) => updateEnv('temperature_max', v ? parseFloat(v) : null)}
                    onSave={handleFieldBlur}
                    type="number"
                    placeholder="e.g., 22"
                  />
                  <EditableField
                    label="Humidity Min (%)"
                    value={env.humidity_min?.toString() || ''}
                    isEditing={isEditing}
                    onChange={(v) => updateEnv('humidity_min', v ? parseFloat(v) : null)}
                    onSave={handleFieldBlur}
                    type="number"
                    placeholder="e.g., 40"
                  />
                  <EditableField
                    label="Humidity Max (%)"
                    value={env.humidity_max?.toString() || ''}
                    isEditing={isEditing}
                    onChange={(v) => updateEnv('humidity_max', v ? parseFloat(v) : null)}
                    onSave={handleFieldBlur}
                    type="number"
                    placeholder="e.g., 60"
                  />
                  <EditableField
                    label="Max Light (lux)"
                    value={env.light_max?.toString() || ''}
                    isEditing={isEditing}
                    onChange={(v) => updateEnv('light_max', v ? parseFloat(v) : null)}
                    onSave={handleFieldBlur}
                    type="number"
                    placeholder="e.g., 50"
                  />
                  <EditableField
                    label="Note"
                    value={env.note || ''}
                    isEditing={isEditing}
                    onChange={(v) => updateEnv('note', v)}
                    onSave={handleFieldBlur}
                    placeholder="Additional environmental notes..."
                    className="col-span-full"
                  />
                </div>
              );
            })()}
          </div>
        )}

        {/* Condition Reports */}
        <div className="pt-4 border-t border-lichen">
          <ConditionReportLinker
            organizationId={orgId}
            objectId={objectId!}
            isEditing={isEditing}
          />
        </div>
      </div>
    </WorkspaceSection>
  );
}

// Rights Section
export function RightsSection({
  orgId,
  objectId,
  isEditing,
  expandedSections,
  toggleSection,
  sectionRefs,
  getSectionOrder,
  isEmpty,
  sectionSummaries,
}: AdminSectionBaseProps) {
  return (
    <WorkspaceSection
      id="rights"
      title="Rights Management"
      icon={<Shield size={18} />}
      hint={sectionSummaries?.rights}
      isEmpty={isEmpty}
      isExpanded={expandedSections.rights}
      onToggle={() => toggleSection('rights')}
      isEditing={isEditing}
      sectionRef={(el) => { sectionRefs.current['rights'] = el; }}
      order={getSectionOrder('rights')}
    >
      <div className="space-y-4">
        <ObjectRightsManager
          organizationId={orgId}
          objectId={objectId!}
          readOnly={!isEditing}
          embedded
        />
      </div>
    </WorkspaceSection>
  );
}

// Acquisition Section
interface AcquisitionSectionProps extends AdminSectionBaseProps {
  formData: FormData | null;
  updateField: <K extends keyof FormData>(field: K, value: FormData[K]) => void;
  handleFieldBlur: () => void;
}

export function AcquisitionSection({
  orgId,
  objectId: _objectId,
  object,
  formData,
  isEditing,
  isCreateMode,
  updateField,
  handleFieldBlur,
  expandedSections,
  toggleSection,
  sectionRefs,
  getSectionOrder,
  isEmpty,
  sectionSummaries,
  isRestricted,
}: AcquisitionSectionProps) {
  return (
    <WorkspaceSection
      id="acquisition"
      title="Acquisition & Provenance"
      icon={<FileText size={18} />}
      hint={sectionSummaries?.acquisition}
      isEmpty={isEmpty}
      isExpanded={expandedSections.acquisition}
      onToggle={() => toggleSection('acquisition')}
      isEditing={isEditing}
      sectionRef={(el) => { sectionRefs.current['acquisition'] = el; }}
      order={getSectionOrder('acquisition')}
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <EditableField
          label="Provenance"
          value={isEditing ? (formData?.provenance || '') : (object?.provenance || '')}
          isEditing={isEditing}
          onChange={(v) => updateField('provenance', v)}
          onSave={handleFieldBlur}
          multiline
          rows={4}
          className="md:col-span-2"
          restricted={isRestricted('provenance')}
        />

        {/* Linked Acquisition Record */}
        {!isCreateMode && orgId && object?.object_id && (
          <div className="md:col-span-2 pt-4 border-t border-lichen">
            <h4 className="text-sm font-medium text-archive mb-3">Linked Acquisition Record</h4>
            <ObjectAcquisitionSelector
              organizationId={orgId}
              objectId={object.object_id}
              currentAcquisition={object.acquisition || null}
              isEditing={isEditing}
            />
          </div>
        )}

        {/* Object History */}
        <div className="md:col-span-2 pt-4 border-t border-lichen">
          <h4 className="text-sm font-medium text-ink mb-3">Object History</h4>
          <div className="space-y-4">
            <EditableField
              label="Object History Note"
              value={isEditing ? (formData?.object_history_note || '') : (object?.object_history_note || '')}
              isEditing={isEditing}
              onChange={(v) => updateField('object_history_note', v)}
              onSave={handleFieldBlur}
              multiline
              rows={3}
              placeholder="Ownership history, exhibition history, publication references..."
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <EditableField
                label="Usage"
                value={isEditing ? (formData?.usage || '') : (object?.usage || '')}
                isEditing={isEditing}
                onChange={(v) => updateField('usage', v)}
                onSave={handleFieldBlur}
                placeholder="How the object was used..."
              />
              <EditableField
                label="Usage Note"
                value={isEditing ? (formData?.usage_note || '') : (object?.usage_note || '')}
                isEditing={isEditing}
                onChange={(v) => updateField('usage_note', v)}
                onSave={handleFieldBlur}
                placeholder="Additional usage details..."
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <EditableField
                label="Cultural Affinity"
                value={isEditing ? (formData?.associated_cultural_affinity || '') : (object?.associated_cultural_affinity || '')}
                isEditing={isEditing}
                onChange={(v) => updateField('associated_cultural_affinity', v)}
                onSave={handleFieldBlur}
                placeholder="e.g., Edo period Japan, Victorian England"
              />
              <EditableField
                label="Association Note"
                value={isEditing ? (formData?.association_note || '') : (object?.association_note || '')}
                isEditing={isEditing}
                onChange={(v) => updateField('association_note', v)}
                onSave={handleFieldBlur}
                placeholder="Notes on cultural or historical associations..."
              />
            </div>
          </div>
        </div>

        {/* Provenance History */}
        <div className="md:col-span-2 pt-4 border-t border-lichen">
          <NameListField
            label="Provenance History"
            items={isEditing ? (formData?.provenance_structured || []) : (object?.provenance_structured || [])}
            isEditing={isEditing}
            onChange={(items) => updateField('provenance_structured', items)}
            onSave={handleFieldBlur}
            nameKey="owner"
            placeholder="Owner name..."
            secondaryFields={[
              { key: 'date_range', label: 'Date Range', placeholder: 'e.g., 1850–1920' },
              { key: 'method', label: 'Method', placeholder: 'e.g., purchase, gift, bequest' },
              { key: 'note', label: 'Note', placeholder: 'Additional details...' },
            ]}
          />
        </div>

        {/* Exhibition History */}
        <div className="md:col-span-2 pt-4 border-t border-lichen">
          <NameListField
            label="Exhibition History"
            items={isEditing ? (formData?.exhibition_history || []) : (object?.exhibition_history || [])}
            isEditing={isEditing}
            onChange={(items) => updateField('exhibition_history', items)}
            onSave={handleFieldBlur}
            nameKey="title"
            placeholder="Exhibition title..."
            secondaryFields={[
              { key: 'venue', label: 'Venue', placeholder: 'Museum or gallery...' },
              { key: 'dates', label: 'Dates', placeholder: 'e.g., Jan–Mar 2024' },
              { key: 'catalog_number', label: 'Catalog #', placeholder: 'Catalog number...' },
            ]}
          />
        </div>

        {/* Publication History */}
        <div className="md:col-span-2 pt-4 border-t border-lichen">
          <NameListField
            label="Publication History"
            items={isEditing ? (formData?.publication_history || []) : (object?.publication_history || [])}
            isEditing={isEditing}
            onChange={(items) => updateField('publication_history', items)}
            onSave={handleFieldBlur}
            nameKey="citation"
            placeholder="Citation or title..."
            secondaryFields={[
              { key: 'author', label: 'Author', placeholder: 'Author name...' },
              { key: 'year', label: 'Year', placeholder: 'e.g., 2024' },
              { key: 'page', label: 'Page', placeholder: 'Page reference...' },
            ]}
          />
        </div>

        {/* Archaeological Context */}
        <div className="md:col-span-2 pt-4 border-t border-lichen">
          <h4 className="text-sm font-medium text-ink mb-3">Archaeological Context</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <EditableField
              label="Excavation Site"
              value={isEditing ? (formData?.excavation_site || '') : (object?.excavation_site || '')}
              isEditing={isEditing}
              onChange={(v) => updateField('excavation_site', v)}
              onSave={handleFieldBlur}
              placeholder="Name of excavation site..."
            />
            <EditableField
              label="Excavation Date"
              value={isEditing ? (formData?.excavation_date || '') : (object?.excavation_date || '')}
              isEditing={isEditing}
              onChange={(v) => updateField('excavation_date', v)}
              onSave={handleFieldBlur}
              placeholder="e.g., Summer 1922"
            />
            <EditableField
              label="Field Collection Number"
              value={isEditing ? (formData?.field_collection_number || '') : (object?.field_collection_number || '')}
              isEditing={isEditing}
              onChange={(v) => updateField('field_collection_number', v)}
              onSave={handleFieldBlur}
              placeholder="Field catalog or find number..."
            />
          </div>
        </div>
      </div>
    </WorkspaceSection>
  );
}

// Valuations Section
interface ValuationsSectionProps extends AdminSectionBaseProps {
  valuationsData: Valuation[] | undefined;
  onAddValuation?: () => void;
}

export function ValuationsSection({
  orgId,
  isEditing,
  valuationsData,
  expandedSections,
  toggleSection,
  sectionRefs,
  getSectionOrder,
  isEmpty,
  sectionSummaries,
  isRestricted,
  onAddValuation,
}: ValuationsSectionProps) {
  if (isRestricted('valuation_history')) return null;

  return (
    <WorkspaceSection
      id="valuations"
      title="Valuations"
      icon={<DollarSign size={18} />}
      hint={sectionSummaries?.valuations}
      isEmpty={isEmpty}
      badge={valuationsData && valuationsData.length > 0 ? `${valuationsData.length} valuations` : undefined}
      isExpanded={expandedSections.valuations}
      onToggle={() => toggleSection('valuations')}
      isEditing={isEditing}
      sectionRef={(el) => { sectionRefs.current['valuations'] = el; }}
      order={getSectionOrder('valuations')}
    >
      <div className="space-y-3">
        {onAddValuation && (
          <div className="flex justify-end">
            <button
              onClick={onAddValuation}
              className="text-sm text-bark hover:text-copper-dark flex items-center gap-1"
            >
              <Plus size={14} />
              Add Valuation
            </button>
          </div>
        )}
        {valuationsData && valuationsData.length > 0 ? (
          valuationsData.map((valuation: Valuation) => (
            <Link
              key={valuation.valuation_id}
              to={`/organizations/${orgId}/collections/valuations/${valuation.valuation_id}`}
              className="block p-3 bg-stone/30 rounded-lg hover:bg-stone/50 transition-colors"
            >
              <div className="flex justify-between items-start">
                <div>
                  <span className="text-xs text-archive capitalize block mb-1">
                    {valuation.valuation_type.replace('_', ' ')}
                  </span>
                  <p className="text-lg font-medium text-ink">
                    {formatCurrency(valuation.valuation_amount, valuation.valuation_currency || 'USD', 0)}
                  </p>
                </div>
                {valuation.is_current && (
                  <span className="text-xs px-2 py-0.5 bg-semantic-success/10 text-semantic-success rounded">
                    Current
                  </span>
                )}
              </div>
            </Link>
          ))
        ) : (
          <p className="text-sm text-archive italic py-2">No valuations recorded</p>
        )}
      </div>
    </WorkspaceSection>
  );
}

// Procedures Section
export function ProceduresSection({
  orgId,
  objectId,
  isEditing,
  expandedSections,
  toggleSection,
  sectionRefs,
  getSectionOrder,
  isEmpty,
  sectionSummaries,
}: AdminSectionBaseProps) {
  return (
    <WorkspaceSection
      id="procedures"
      title="Related Procedures"
      icon={<FileText size={18} />}
      hint={sectionSummaries?.procedures}
      isEmpty={isEmpty}
      isExpanded={expandedSections.procedures}
      onToggle={() => toggleSection('procedures')}
      isEditing={isEditing}
      sectionRef={(el) => { sectionRefs.current['procedures'] = el; }}
      order={getSectionOrder('procedures')}
    >
      <RelatedProcedures
        organizationId={orgId}
        objectId={objectId!}
      />
    </WorkspaceSection>
  );
}

// NAGPRA Section
export function NagpraSection({
  orgId,
  objectId,
  isEditing,
  expandedSections,
  toggleSection,
  sectionRefs,
  getSectionOrder,
  isEmpty,
  sectionSummaries,
}: AdminSectionBaseProps) {
  return (
    <WorkspaceSection
      id="nagpra"
      title="NAGPRA Compliance"
      icon={<Shield size={18} />}
      hint={sectionSummaries?.nagpra}
      isEmpty={isEmpty}
      isExpanded={expandedSections.nagpra}
      onToggle={() => toggleSection('nagpra')}
      isEditing={isEditing}
      sectionRef={(el) => { sectionRefs.current['nagpra'] = el; }}
      order={getSectionOrder('nagpra')}
    >
      <NagpraManager
        organizationId={orgId}
        objectId={objectId!}
        readOnly={!isEditing}
      />
    </WorkspaceSection>
  );
}

// Parts Section
interface PartsSectionProps extends AdminSectionBaseProps {
  object: CollectionObject;
}

export function PartsSection({
  orgId,
  objectId,
  object,
  isEditing,
  expandedSections,
  toggleSection,
  sectionRefs,
  getSectionOrder,
  isEmpty,
  sectionSummaries,
}: PartsSectionProps) {
  const partsCount = object?.parts?.length ?? 0;

  return (
    <WorkspaceSection
      id="parts"
      title="Parts"
      icon={<Package size={18} />}
      hint={sectionSummaries?.parts}
      isEmpty={isEmpty}
      badge={partsCount > 1 ? `${partsCount} parts` : undefined}
      isExpanded={expandedSections.parts}
      onToggle={() => toggleSection('parts')}
      isEditing={isEditing}
      sectionRef={(el) => { sectionRefs.current['parts'] = el; }}
      order={getSectionOrder('parts')}
    >
      <ObjectPartsManager
        organizationId={orgId}
        objectId={objectId!}
        objectNumber={object?.object_number}
        readOnly={!isEditing}
      />
    </WorkspaceSection>
  );
}
