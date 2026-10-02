import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Image,
  CheckCircle,
  ClipboardCheck,
  AlertCircle,
  ExternalLink,
  Loader2,
  X,
  ChevronDown,
} from 'lucide-react';
import {
  getExhibitionObjects,
  addExhibitionObject,
  updateExhibitionObject,
  removeExhibitionObject,
  getCollectionObjects,
  getConditionReports,
} from '../../lib/api';
import type { ExhibitionObject } from '../../lib/api';
import type { CollectionObjectListItem } from '../../lib/schemas';
import { RecordLinker } from '../records';
import SlideOver from '../ui/SlideOver';

const STATUS_OPTIONS = [
  { value: 'planned', label: 'Planned', description: 'Object planned for exhibition' },
  { value: 'confirmed', label: 'Confirmed', description: 'Object confirmed for display' },
  { value: 'on_display', label: 'On Display', description: 'Currently in exhibition' },
  { value: 'returned', label: 'Returned', description: 'Returned after exhibition' },
];

const STATUS_STYLES: Record<string, string> = {
  planned: 'bg-stone text-archive',
  confirmed: 'bg-semantic-info/10 text-semantic-info',
  on_display: 'bg-semantic-success/10 text-semantic-success',
  returned: 'bg-bark/10 text-bark',
};

interface ExhibitionObjectLinkerProps {
  organizationId: string;
  exhibitionId: string;
  isEditing?: boolean;
  onCountChange?: (count: number) => void;
}

/**
 * Component to manage objects linked to an exhibition.
 */
export function ExhibitionObjectLinker({
  organizationId,
  exhibitionId,
  isEditing = false,
  onCountChange,
}: ExhibitionObjectLinkerProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['exhibition-objects', organizationId, exhibitionId],
    queryFn: () => getExhibitionObjects(organizationId, exhibitionId),
    enabled: !!organizationId && !!exhibitionId,
  });

  const linkedObjects = data?.exhibition_objects || [];

  return (
    <RecordLinker<ExhibitionObject, CollectionObjectListItem>
      organizationId={organizationId}
      onCountChange={onCountChange}
      title="Exhibition Objects"
      addLabel="Add Object"
      emptyMessage="No objects in this exhibition yet."
      linkedItems={linkedObjects}
      isLoading={isLoading}
      getItemId={(obj) => obj.exhibition_object_id}
      getLinkedEntityId={(obj) => obj.object_id || obj.entity_key || obj.exhibition_object_id}
      renderItem={(obj) => (
        <>
          {(obj.thumbnail_url || obj.primary_image_url) ? (
            <img
              src={obj.thumbnail_url || obj.primary_image_url!}
              alt={obj.title || 'Object'}
              className="w-10 h-10 object-cover rounded"
            />
          ) : (
            <div className="w-10 h-10 bg-stone rounded flex items-center justify-center">
              <Image size={16} className="text-archive" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-ink truncate">
              {obj.title || 'Untitled'}
            </div>
            <div className="text-xs text-archive truncate">
              {obj.object_number}
              {obj.creator && ` \u00b7 ${obj.creator}`}
              {obj.section && ` \u00b7 ${obj.section}`}
            </div>
          </div>
          <span
            className={`px-2 py-0.5 text-xs font-medium rounded-full ${
              STATUS_STYLES[obj.object_status] || STATUS_STYLES.planned
            }`}
          >
            {obj.object_status.replace('_', ' ')}
          </span>
          {obj.loan_in_id && (
            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-copper/10 text-copper">
              Loan
            </span>
          )}
          {obj.condition_in_report_id || obj.condition_out_report_id ? (
            <Link
              to={`/organizations/${organizationId}/collections/objects/${obj.object_id}/condition-reports`}
              className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-semantic-success/10 text-semantic-success hover:bg-semantic-success/20"
              title={`Condition: ${obj.condition_in_report_id ? 'In' : ''} ${obj.condition_in_report_id && obj.condition_out_report_id ? '& ' : ''}${obj.condition_out_report_id ? 'Out' : ''}`}
              onClick={(e) => e.stopPropagation()}
            >
              <ClipboardCheck size={12} />
              CR
            </Link>
          ) : obj.object_status === 'on_display' ||
            obj.object_status === 'confirmed' ? (
            <span
              className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-semantic-warning/10 text-semantic-warning"
              title="No condition report"
            >
              <AlertCircle size={12} />
              CR
            </span>
          ) : null}
        </>
      )}
      getItemHref={(obj) =>
        obj.object_id
          ? `/organizations/${organizationId}/collections/objects/${obj.object_id}`
          : null
      }
      isEditing={isEditing}
      onLink={async (obj: CollectionObjectListItem, metadata) => {
        await addExhibitionObject(organizationId, exhibitionId, {
          object_id: obj.object_id,
          section: metadata.section || undefined,
        });
      }}
      onUnlink={async (obj) => {
        await removeExhibitionObject(
          organizationId,
          exhibitionId,
          obj.exhibition_object_id
        );
      }}
      bulkSelect
      metadataFields={[
        {
          key: 'section',
          label: 'Section (Optional)',
          type: 'text',
          placeholder: 'e.g., Gallery A, Introduction, Theme 1',
        },
      ]}
      editLink={{
        renderEditSlideOver: (item, onClose, onSuccess) => (
          <EditObjectSlideOver
            organizationId={organizationId}
            exhibitionId={exhibitionId}
            exhibitionObject={item}
            onClose={onClose}
            onSuccess={onSuccess}
          />
        ),
      }}
      search={{
        title: 'Add Objects to Exhibition',
        subtitle: 'Search for objects to include in this exhibition',
        placeholder: 'Search by title, number, or creator...',
        searchLabel: 'Search Objects',
        queryKey: ['collection-objects-search', organizationId],
        searchFn: async (term) => {
          const result = await getCollectionObjects(organizationId, {
            search: term,
            limit: 30,
          });
          return result.items || [];
        },
        getSearchItemId: (obj) => obj.object_id,
        getSearchItemLabel: (obj) => obj.title || obj.object_number,
        renderSearchItem: (obj, isSelected) => (
          <>
            {obj.primary_image_url ? (
              <img
                src={obj.primary_image_url}
                alt={obj.title || 'Object'}
                className="w-10 h-10 object-cover rounded shrink-0"
              />
            ) : (
              <div className="w-10 h-10 bg-stone rounded flex items-center justify-center shrink-0">
                <Image size={16} className="text-archive" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm text-ink font-medium truncate">
                {obj.title || 'Untitled'}
              </p>
              <p className="text-xs text-archive truncate">
                {obj.object_number}
                {obj.creators &&
                  obj.creators[0] &&
                  ` \u00b7 ${obj.creators[0].name}`}
              </p>
            </div>
            {isSelected && (
              <CheckCircle size={16} className="text-bark shrink-0" />
            )}
          </>
        ),
      }}
      invalidateKeys={[
        ['exhibition-objects', organizationId, exhibitionId],
      ]}
      submitLabel="Add Object"
    />
  );
}

// =============================================================================
// Condition Report Selector
// =============================================================================

interface ConditionReportOption {
  report_id: string;
  report_number: string;
  report_date: string;
  overall_condition?: string;
  report_type?: string;
}

function ConditionReportSelector({
  organizationId,
  objectId,
  label,
  value,
  onChange,
}: {
  organizationId: string;
  objectId: string | null | undefined;
  label: string;
  value: string | null | undefined;
  onChange: (reportId: string | null) => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['condition-reports', organizationId, objectId],
    queryFn: () =>
      getConditionReports(organizationId, {
        object_id: objectId!,
        limit: 50,
      }),
    enabled: !!organizationId && !!objectId,
  });

  const reports: ConditionReportOption[] = (data?.items || []).map((r: any) => ({
    report_id: r.report_id,
    report_number: r.report_number,
    report_date: r.report_date,
    overall_condition: r.overall_condition,
    report_type: r.report_type,
  }));

  const selectedReport = reports.find((r) => r.report_id === value);

  if (!objectId) {
    return (
      <div className="p-3 bg-stone/30 rounded-lg">
        <div className="flex items-center gap-2">
          <ClipboardCheck size={16} className="text-archive" />
          <span className="text-sm text-archive">{label}</span>
        </div>
        <p className="text-xs text-archive mt-1">Not available for Bridge entities</p>
      </div>
    );
  }

  return (
    <div className="p-3 bg-stone/30 rounded-lg space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ClipboardCheck size={16} className="text-ink/50" />
          <span className="text-sm font-medium text-ink">{label}</span>
        </div>
        {value && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-archive hover:text-semantic-error p-0.5"
            title="Unlink report"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {selectedReport ? (
        <div className="flex items-center justify-between pl-6">
          <div>
            <p className="text-sm text-ink">{selectedReport.report_number}</p>
            <p className="text-xs text-archive">
              {selectedReport.report_date}
              {selectedReport.overall_condition && ` · ${selectedReport.overall_condition}`}
            </p>
          </div>
          <Link
            to={`/organizations/${organizationId}/collections/condition-reports/${selectedReport.report_id}`}
            className="text-sm text-bark hover:text-copper-dark flex items-center gap-1"
          >
            View
            <ExternalLink size={12} />
          </Link>
        </div>
      ) : (
        <div className="relative pl-6">
          {isLoading ? (
            <div className="flex items-center gap-2 text-xs text-archive py-1">
              <Loader2 size={12} className="animate-spin" />
              Loading reports...
            </div>
          ) : reports.length === 0 ? (
            <p className="text-xs text-archive py-1">
              No condition reports for this object.{' '}
              <Link
                to={`/organizations/${organizationId}/collections/condition-reports/new?object_id=${objectId}`}
                className="text-bark hover:text-copper-dark"
              >
                Create one
              </Link>
            </p>
          ) : (
            <div className="relative">
              <select
                value=""
                onChange={(e) => onChange(e.target.value || null)}
                className="w-full appearance-none bg-parchment border border-lichen rounded-lg px-3 py-1.5 pr-8 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
              >
                <option value="">Select a report...</option>
                {reports.map((r) => (
                  <option key={r.report_id} value={r.report_id}>
                    {r.report_number} — {r.report_date}
                    {r.overall_condition ? ` (${r.overall_condition})` : ''}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={14}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-archive pointer-events-none"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Edit Exhibition Object Slide-Over
// =============================================================================

interface EditObjectSlideOverProps {
  organizationId: string;
  exhibitionId: string;
  exhibitionObject: ExhibitionObject;
  onClose: () => void;
  onSuccess: () => void;
}

function EditObjectSlideOver({
  organizationId,
  exhibitionId,
  exhibitionObject,
  onClose,
  onSuccess,
}: EditObjectSlideOverProps) {
  const [section, setSection] = useState(exhibitionObject.section || '');
  const [objectStatus, setObjectStatus] = useState(
    exhibitionObject.object_status
  );
  const [creditLineOverride, setCreditLineOverride] = useState(
    exhibitionObject.credit_line_override || ''
  );
  const [specialRequirements, setSpecialRequirements] = useState(
    exhibitionObject.special_requirements || ''
  );
  const [installationNotes, setInstallationNotes] = useState(
    exhibitionObject.installation_notes || ''
  );
  const [conditionInReportId, setConditionInReportId] = useState<string | null>(
    exhibitionObject.condition_in_report_id || null
  );
  const [conditionOutReportId, setConditionOutReportId] = useState<string | null>(
    exhibitionObject.condition_out_report_id || null
  );
  const [error, setError] = useState<string | null>(null);

  const updateMutation = useMutation({
    mutationFn: () =>
      updateExhibitionObject(
        organizationId,
        exhibitionId,
        exhibitionObject.exhibition_object_id,
        {
          section: section || undefined,
          object_status: objectStatus,
          credit_line_override: creditLineOverride || undefined,
          special_requirements: specialRequirements || undefined,
          installation_notes: installationNotes || undefined,
          condition_in_report_id: conditionInReportId,
          condition_out_report_id: conditionOutReportId,
        }
      ),
    onSuccess,
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  return (
    <SlideOver
      isOpen
      onClose={onClose}
      title="Edit Exhibition Object"
      subtitle={
        exhibitionObject.title ||
        exhibitionObject.object_number ||
        'Object'
      }
      width="md"
      footer={
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm border border-lichen rounded-lg hover:bg-stone/50"
          >
            Cancel
          </button>
          <button
            onClick={() => updateMutation.mutate()}
            disabled={updateMutation.isPending}
            className="px-4 py-2 text-sm bg-bark text-parchment rounded-lg hover:bg-copper-dark disabled:opacity-50 flex items-center gap-2"
          >
            {updateMutation.isPending ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Saving...
              </>
            ) : (
              'Save Changes'
            )}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {error && (
          <div className="p-3 bg-semantic-error/10 border border-semantic-error/30 rounded-lg text-sm text-semantic-error">
            {error}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-ink mb-1.5">
            Status
          </label>
          <div className="space-y-2">
            {STATUS_OPTIONS.map((option) => (
              <label
                key={option.value}
                className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                  objectStatus === option.value
                    ? 'border-bark bg-bark/5'
                    : 'border-lichen hover:border-bark/30'
                }`}
              >
                <input
                  type="radio"
                  name="status"
                  value={option.value}
                  checked={objectStatus === option.value}
                  onChange={(e) =>
                    setObjectStatus(
                      e.target.value as ExhibitionObject['object_status']
                    )
                  }
                  className="mt-0.5"
                />
                <div>
                  <p className="text-sm font-medium text-ink">{option.label}</p>
                  <p className="text-xs text-archive">{option.description}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-ink mb-1.5">
            Section
          </label>
          <input
            type="text"
            value={section}
            onChange={(e) => setSection(e.target.value)}
            placeholder="e.g., Gallery A, Introduction"
            className="w-full px-3 py-2 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-ink mb-1.5">
            Credit Line Override
          </label>
          <input
            type="text"
            value={creditLineOverride}
            onChange={(e) => setCreditLineOverride(e.target.value)}
            placeholder="Override object credit line for this exhibition"
            className="w-full px-3 py-2 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-ink mb-1.5">
            Special Requirements
          </label>
          <textarea
            value={specialRequirements}
            onChange={(e) => setSpecialRequirements(e.target.value)}
            rows={2}
            placeholder="Special handling or display requirements"
            className="w-full px-3 py-2 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark resize-none"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-ink mb-1.5">
            Installation Notes
          </label>
          <textarea
            value={installationNotes}
            onChange={(e) => setInstallationNotes(e.target.value)}
            rows={2}
            placeholder="Notes for installation team"
            className="w-full px-3 py-2 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark resize-none"
          />
        </div>

        {/* Condition Reports Section */}
        <div className="pt-4 border-t border-lichen">
          <label className="block text-sm font-medium text-ink mb-2">
            Condition Reports
          </label>
          <div className="space-y-2">
            <ConditionReportSelector
              organizationId={organizationId}
              objectId={exhibitionObject.object_id}
              label="Condition In"
              value={conditionInReportId}
              onChange={setConditionInReportId}
            />
            <ConditionReportSelector
              organizationId={organizationId}
              objectId={exhibitionObject.object_id}
              label="Condition Out"
              value={conditionOutReportId}
              onChange={setConditionOutReportId}
            />
          </div>
        </div>
      </div>
    </SlideOver>
  );
}

export default ExhibitionObjectLinker;
