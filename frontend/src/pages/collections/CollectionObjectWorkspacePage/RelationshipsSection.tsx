import { useState } from 'react';
import { Users, MapPin, ArrowRightLeft, BookOpen, Tag, Calendar, Plus, X } from 'lucide-react';
import { WorkspaceSection } from '../../../components/workspace';
import { ConstituentLinker } from '../../../components/collections/ConstituentLinker';
import { PlaceAuthorityLinker } from '../../../components/collections/PlaceAuthorityLinker';
import { StylePeriodLinker } from '../../../components/collections/StylePeriodLinker';
import { SubjectLinker } from '../../../components/collections/SubjectLinker';
import { AuthorityAutocomplete } from '../../../components/collections/AuthorityAutocomplete';
import type { AuthorityBackedValue } from '../../../components/collections/AuthorityAutocomplete';
import type { FieldType } from '../../../components/collections/AuthorityAutocomplete/types';
import { ObjectRelationshipsManager } from '../../../components/collections/ObjectRelationshipsManager';
import { ObjectCitationsManager } from '../../../components/collections/ObjectCitationsManager';
import { ObjectEventLinker } from '../../../components/collections/ObjectEventLinker';
import type { CollectionObject } from '../../../lib/schemas';
import type { FormData } from './types';

// ---------------------------------------------------------------------------
// AuthorityStringListField — a list of strings backed by AuthorityAutocomplete
// ---------------------------------------------------------------------------

function AuthorityStringListField({
  label,
  items,
  isEditing,
  onChange,
  onSave,
  placeholder,
  fieldType,
}: {
  label: string;
  items: string[];
  isEditing: boolean;
  onChange: (items: string[]) => void;
  onSave: () => void;
  placeholder?: string;
  fieldType: FieldType;
}) {
  if (!isEditing) {
    if (!items || items.length === 0) {
      return (
        <div>
          <dt className="text-sm font-medium text-archive">{label}</dt>
          <dd className="mt-1 text-sm text-archive italic">None</dd>
        </div>
      );
    }
    return (
      <div>
        <dt className="text-sm font-medium text-archive">{label}</dt>
        <dd className="mt-1 flex flex-wrap gap-1.5">
          {items.map((item, i) => (
            <span key={i} className="px-2 py-1 bg-stone/50 text-ink text-sm rounded">
              {item}
            </span>
          ))}
        </dd>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-sm font-medium text-ink">{label}</label>
        <button
          type="button"
          onClick={() => onChange([...items, ''])}
          className="text-sm text-bark hover:text-copper-dark flex items-center gap-1"
        >
          <Plus size={14} />
          Add
        </button>
      </div>
      <div className="space-y-2">
        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="flex-1">
              <AuthorityAutocomplete
                fieldType={fieldType}
                value={item ? { value: item } : null}
                onChange={(val: AuthorityBackedValue | null) => {
                  const updated = [...items];
                  updated[i] = val?.value || '';
                  onChange(updated);
                  onSave();
                }}
                placeholder={placeholder}
                allowCreate={true}
                showVerifiedBadge={false}
              />
            </div>
            <button
              type="button"
              onClick={() => {
                onChange(items.filter((_, idx) => idx !== i));
                onSave();
              }}
              className="p-1 text-archive hover:text-semantic-error transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

interface RelationshipsSectionProps {
  orgId: string;
  objectId: string;
  object: CollectionObject | null;
  isEditing: boolean;
  isCreateMode: boolean;
  expandedSections: Record<string, boolean>;
  toggleSection: (sectionId: string) => void;
  sectionRefs: React.MutableRefObject<Record<string, HTMLDivElement | null>>;
  getSectionOrder: (sectionId: string) => number;
  isEmpty?: boolean;
  sectionSummaries?: Record<string, string | undefined>;
}

interface SubjectsSectionProps extends RelationshipsSectionProps {
  formData: FormData | null;
  updateField: <K extends keyof FormData>(field: K, value: FormData[K]) => void;
  handleFieldBlur: () => void;
}

export function PeopleSection({
  orgId,
  objectId,
  object: _object,
  isEditing,
  expandedSections,
  toggleSection,
  sectionRefs,
  getSectionOrder,
  isEmpty,
  sectionSummaries,
}: RelationshipsSectionProps) {
  const [count, setCount] = useState(0);
  return (
    <WorkspaceSection
      id="people"
      title="People"
      icon={<Users size={18} />}
      badge={count > 0 ? String(count) : undefined}
      hint={sectionSummaries?.people}
      isEmpty={isEmpty}
      isExpanded={expandedSections.people}
      onToggle={() => toggleSection('people')}
      isEditing={isEditing}
      sectionRef={(el) => { sectionRefs.current['people'] = el; }}
      order={getSectionOrder('people')}
    >
      <ConstituentLinker
        organizationId={orgId}
        objectId={objectId}
        isEditing={isEditing}
        excludedRoles={['depicted']}
        onCountChange={setCount}
      />
    </WorkspaceSection>
  );
}

export function PlacesSection({
  orgId,
  objectId,
  object: _object,
  isEditing,
  expandedSections,
  toggleSection,
  sectionRefs,
  getSectionOrder,
  isEmpty,
  sectionSummaries,
}: RelationshipsSectionProps) {
  const [count, setCount] = useState(0);
  return (
    <WorkspaceSection
      id="places"
      title="Places"
      icon={<MapPin size={18} />}
      badge={count > 0 ? String(count) : undefined}
      hint={sectionSummaries?.places}
      isEmpty={isEmpty}
      isExpanded={expandedSections.places}
      onToggle={() => toggleSection('places')}
      isEditing={isEditing}
      sectionRef={(el) => { sectionRefs.current['places'] = el; }}
      order={getSectionOrder('places')}
    >
      <PlaceAuthorityLinker
        organizationId={orgId}
        objectId={objectId}
        readOnly={!isEditing}
        embedded
        excludedRoles={['depicted_place']}
        onCountChange={setCount}
      />
    </WorkspaceSection>
  );
}

export function StylePeriodsSection({
  orgId,
  objectId,
  object: _object,
  isEditing,
  expandedSections,
  toggleSection,
  sectionRefs,
  getSectionOrder,
  isEmpty,
  sectionSummaries,
}: RelationshipsSectionProps) {
  const [count, setCount] = useState(0);
  return (
    <WorkspaceSection
      id="stylePeriods"
      title="Styles & Periods"
      icon={<Tag size={18} />}
      badge={count > 0 ? String(count) : undefined}
      hint={sectionSummaries?.stylePeriods}
      isEmpty={isEmpty}
      isExpanded={expandedSections.stylePeriods}
      onToggle={() => toggleSection('stylePeriods')}
      isEditing={isEditing}
      sectionRef={(el) => { sectionRefs.current['stylePeriods'] = el; }}
      order={getSectionOrder('stylePeriods')}
    >
      <StylePeriodLinker
        organizationId={orgId}
        objectId={objectId}
        readOnly={!isEditing}
        embedded
        onCountChange={setCount}
      />
    </WorkspaceSection>
  );
}

export function SubjectsSection({
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
}: SubjectsSectionProps) {
  const [subjectCount, setSubjectCount] = useState(0);
  const [depictedPeopleCount, setDepictedPeopleCount] = useState(0);
  const [depictedPlacesCount, setDepictedPlacesCount] = useState(0);
  const totalCount = subjectCount + depictedPeopleCount + depictedPlacesCount;
  const hint = totalCount > 0 ? `${totalCount} linked` : sectionSummaries?.subjects;

  return (
    <WorkspaceSection
      id="subjects"
      title="Subjects"
      icon={<BookOpen size={18} />}
      badge={totalCount > 0 ? String(totalCount) : undefined}
      hint={hint}
      isEmpty={isEmpty}
      isExpanded={expandedSections.subjects}
      onToggle={() => toggleSection('subjects')}
      isEditing={isEditing}
      sectionRef={(el) => { sectionRefs.current['subjects'] = el; }}
      order={getSectionOrder('subjects')}
    >
      <div className="space-y-4">
        <SubjectLinker
          organizationId={orgId}
          objectId={objectId}
          readOnly={!isEditing}
          embedded
          onCountChange={setSubjectCount}
        />

        {/* Depicted People & Organizations (filtered ConstituentLinker) */}
        {objectId && (
          <ConstituentLinker
            organizationId={orgId}
            objectId={objectId}
            isEditing={isEditing}
            allowedRoles={['depicted']}
            title="Depicted People & Organizations"
            addLabel="Add Depicted"
            onCountChange={setDepictedPeopleCount}
          />
        )}

        {/* Depicted Places (filtered PlaceAuthorityLinker) */}
        {objectId && (
          <PlaceAuthorityLinker
            organizationId={orgId}
            objectId={objectId}
            readOnly={!isEditing}
            allowedRoles={['depicted_place']}
            title="Depicted Places"
            addLabel="Add Depicted Place"
            onCountChange={setDepictedPlacesCount}
          />
        )}

        <AuthorityStringListField
          label="Depicted Activities"
          items={isEditing ? (formData?.depicted_activities || []) : (object?.depicted_activities || [])}
          isEditing={isEditing}
          onChange={(items) => updateField('depicted_activities', items)}
          onSave={handleFieldBlur}
          placeholder="e.g., dancing, hunting, weaving..."
          fieldType="subject"
        />
        <AuthorityStringListField
          label="Depicted Concepts"
          items={isEditing ? (formData?.depicted_concepts || []) : (object?.depicted_concepts || [])}
          isEditing={isEditing}
          onChange={(items) => updateField('depicted_concepts', items)}
          onSave={handleFieldBlur}
          placeholder="e.g., justice, fertility, mourning..."
          fieldType="subject"
        />
        <AuthorityStringListField
          label="Associated Concepts"
          items={isEditing ? (formData?.associated_concepts || []) : (object?.associated_concepts || [])}
          isEditing={isEditing}
          onChange={(items) => updateField('associated_concepts', items)}
          onSave={handleFieldBlur}
          placeholder="e.g., Buddhism, Art Nouveau..."
          fieldType="subject"
        />
      </div>
    </WorkspaceSection>
  );
}

export function RelatedObjectsSection({
  orgId,
  objectId,
  object: _object,
  isEditing,
  expandedSections,
  toggleSection,
  sectionRefs,
  getSectionOrder,
  isEmpty,
  sectionSummaries,
}: RelationshipsSectionProps) {
  const [count, setCount] = useState(0);
  return (
    <WorkspaceSection
      id="relationships"
      title="Related Objects"
      icon={<ArrowRightLeft size={18} />}
      badge={count > 0 ? String(count) : undefined}
      hint={sectionSummaries?.relationships}
      isEmpty={isEmpty}
      isExpanded={expandedSections.relationships}
      onToggle={() => toggleSection('relationships')}
      isEditing={isEditing}
      sectionRef={(el) => { sectionRefs.current['relationships'] = el; }}
      order={getSectionOrder('relationships')}
    >
      <ObjectRelationshipsManager
        organizationId={orgId}
        objectId={objectId}
        readOnly={!isEditing}
        embedded
        onCountChange={setCount}
      />
    </WorkspaceSection>
  );
}

export function CitationsSection({
  orgId,
  objectId,
  object: _object,
  isEditing,
  expandedSections,
  toggleSection,
  sectionRefs,
  getSectionOrder,
  isEmpty,
  sectionSummaries,
}: RelationshipsSectionProps) {
  const [count, setCount] = useState(0);
  return (
    <WorkspaceSection
      id="citations"
      title="Citations & References"
      icon={<BookOpen size={18} />}
      badge={count > 0 ? String(count) : undefined}
      hint={sectionSummaries?.citations}
      isEmpty={isEmpty}
      isExpanded={expandedSections.citations}
      onToggle={() => toggleSection('citations')}
      isEditing={isEditing}
      sectionRef={(el) => { sectionRefs.current['citations'] = el; }}
      order={getSectionOrder('citations')}
    >
      <ObjectCitationsManager
        organizationId={orgId}
        objectId={objectId}
        readOnly={!isEditing}
        embedded
        onCountChange={setCount}
      />
    </WorkspaceSection>
  );
}

export function EventsSection({
  orgId,
  objectId,
  object,
  isEditing,
  isCreateMode,
  expandedSections,
  toggleSection,
  sectionRefs,
  getSectionOrder,
  isEmpty,
  sectionSummaries,
}: RelationshipsSectionProps) {
  const [count, setCount] = useState(0);
  if (isCreateMode) return null;

  return (
    <WorkspaceSection
      id="events"
      title="Related Events"
      icon={<Calendar size={18} />}
      badge={count > 0 ? String(count) : undefined}
      hint={sectionSummaries?.events}
      isEmpty={isEmpty}
      isExpanded={expandedSections.events}
      onToggle={() => toggleSection('events')}
      isEditing={isEditing}
      sectionRef={(el) => { sectionRefs.current['events'] = el; }}
      order={getSectionOrder('events')}
    >
      <ObjectEventLinker
        organizationId={orgId}
        objectId={objectId}
        objectNumber={object?.object_number}
        objectTitle={object?.titles?.[0]?.title || object?.object_name || undefined}
        isEditing={isEditing}
        onCountChange={setCount}
      />
    </WorkspaceSection>
  );
}
