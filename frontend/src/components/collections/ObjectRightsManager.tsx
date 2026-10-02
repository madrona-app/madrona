import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Checkbox from '../Checkbox';
import { Link } from 'react-router-dom';
import {
  Plus,
  Shield,
  Trash2,
  Edit2,
  Loader2,
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  Globe,
  X,
} from 'lucide-react';
import ConfirmDialog from '../ConfirmDialog';
import { getObjectRights, deleteObjectRight, createObjectRight, getContact } from '../../lib/api';
import { formatDateShort } from '../../lib/formatters';
import type { ObjectRight } from '../../lib/schemas';
import SlideOver from '../ui/SlideOver';
import { ContactSelectorSlideOver } from './ConstituentSelectorSlideOver';

interface ObjectRightsManagerProps {
  organizationId: string;
  objectId: string;
  readOnly?: boolean;
  embedded?: boolean;
}

const RIGHT_TYPE_LABELS: Record<string, string> = {
  copyright: 'Copyright',
  reproduction: 'Reproduction',
  exhibition: 'Exhibition',
  publication: 'Publication',
  broadcast: 'Broadcast',
  performance: 'Performance',
  adaptation: 'Adaptation',
  distribution: 'Distribution',
  moral_rights: 'Moral Rights',
  database_rights: 'Database Rights',
  trademark: 'Trademark',
  other: 'Other',
};

const RIGHT_TYPE_OPTIONS = [
  { value: 'copyright', label: 'Copyright' },
  { value: 'reproduction', label: 'Reproduction' },
  { value: 'exhibition', label: 'Exhibition' },
  { value: 'publication', label: 'Publication' },
  { value: 'broadcast', label: 'Broadcast' },
  { value: 'performance', label: 'Performance' },
  { value: 'adaptation', label: 'Adaptation' },
  { value: 'distribution', label: 'Distribution' },
  { value: 'moral_rights', label: 'Moral Rights' },
  { value: 'database_rights', label: 'Database Rights' },
  { value: 'trademark', label: 'Trademark' },
  { value: 'other', label: 'Other' },
];

const STATUS_LABELS: Record<string, string> = {
  unknown: 'Unknown',
  public_domain: 'Public Domain',
  owned: 'Owned',
  licensed: 'Licensed',
  granted: 'Granted',
  requested: 'Requested',
  denied: 'Denied',
  expired: 'Expired',
  orphan: 'Orphan Work',
  disputed: 'Disputed',
};

const STATUS_OPTIONS = [
  { value: 'unknown', label: 'Unknown' },
  { value: 'public_domain', label: 'Public Domain' },
  { value: 'owned', label: 'Owned' },
  { value: 'licensed', label: 'Licensed' },
  { value: 'granted', label: 'Granted' },
  { value: 'requested', label: 'Requested' },
  { value: 'denied', label: 'Denied' },
  { value: 'expired', label: 'Expired' },
  { value: 'orphan', label: 'Orphan Work' },
  { value: 'disputed', label: 'Disputed' },
];

const STATUS_STYLES: Record<string, string> = {
  unknown: 'badge-neutral',
  public_domain: 'badge-success-subtle',
  owned: 'badge-info-subtle',
  licensed: 'bg-forest/10 text-forest',
  granted: 'badge-success-subtle',
  requested: 'bg-semantic-warning/10 text-semantic-warning',
  denied: 'bg-semantic-error/10 text-semantic-error',
  expired: 'badge-neutral',
  orphan: 'bg-copper/10 text-copper',
  disputed: 'bg-semantic-error/10 text-semantic-error',
};

export function ObjectRightsManager({
  organizationId,
  objectId,
  readOnly = false,
}: ObjectRightsManagerProps) {
  const queryClient = useQueryClient();
  const [showSlideOver, setShowSlideOver] = useState(false);

  const {
    data: rights,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['object-rights', organizationId, objectId],
    queryFn: () => getObjectRights(organizationId, objectId),
    enabled: !!organizationId && !!objectId,
  });

  const deleteMutation = useMutation({
    mutationFn: (rightId: string) => deleteObjectRight(organizationId, rightId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['object-rights', organizationId, objectId] });
    },
  });

  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const handleDelete = (rightId: string) => {
    setDeleteTarget(rightId);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 size={24} className="animate-spin text-archive" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 text-sm text-archive">
        <AlertCircle size={16} />
        <span>Failed to load rights</span>
      </div>
    );
  }

  const rightsList = rights || [];

  // Group rights by type
  const groupedRights: Record<string, ObjectRight[]> = {};
  rightsList.forEach((right: ObjectRight) => {
    const type = right.right_type;
    if (!groupedRights[type]) {
      groupedRights[type] = [];
    }
    groupedRights[type].push(right);
  });

  // Check for any orphan works
  const hasOrphanWorks = rightsList.some((r: ObjectRight) => r.is_orphan_work);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-ink">
          Rights Records ({rightsList.length})
          {hasOrphanWorks && (
            <span className="ml-2" title="Contains orphan works">
              <AlertTriangle size={14} className="text-copper inline" />
            </span>
          )}
        </h4>
        {!readOnly && (
          <button
            onClick={() => setShowSlideOver(true)}
            className="flex items-center gap-1 text-sm text-bark hover:text-copper-dark"
          >
            <Plus size={14} />
            Add Right
          </button>
        )}
      </div>

      {/* Rights List */}
      {rightsList.length === 0 ? (
        <div className="text-sm text-archive italic py-4 text-center">
          No rights records.
          {!readOnly && (
            <button
              onClick={() => setShowSlideOver(true)}
              className="block mx-auto mt-2 text-bark hover:text-copper-dark"
            >
              Add right
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(groupedRights).map(([type, typeRights]) => (
            <div key={type}>
              <h5 className="text-xs font-medium text-archive uppercase tracking-wide mb-2">
                {RIGHT_TYPE_LABELS[type] || type}
              </h5>
              <div className="space-y-2">
                {typeRights.map((right: ObjectRight) => (
                  <div
                    key={right.right_id}
                    className="flex items-center justify-between p-3 border border-lichen rounded-lg bg-parchment"
                  >
                    <div className="flex items-center gap-3">
                      <Shield size={16} className="text-archive" />
                      <div>
                        <div className="flex items-center gap-2">
                          <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${STATUS_STYLES[right.status] || 'badge-neutral'}`}>
                            {STATUS_LABELS[right.status] || right.status}
                          </span>
                          <span className="text-sm font-medium text-ink">
                            {right.rights_holder_contact?.name || 'No holder assigned'}
                          </span>
                          {right.is_orphan_work && (
                            <span className="text-xs text-copper inline-flex items-center gap-1">
                              <AlertTriangle size={10} />
                              Orphan
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-archive mt-1">
                          {right.is_perpetual ? (
                            <span className="inline-flex items-center gap-1">
                              <CheckCircle size={10} />
                              Perpetual
                            </span>
                          ) : right.end_date ? (
                            <span>Until {formatDateShort(right.end_date)}</span>
                          ) : null}
                          {right.territory && (
                            <span className="ml-2 inline-flex items-center gap-1">
                              <Globe size={10} />
                              {right.territory}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Link
                        to={`/organizations/${organizationId}/collections/rights/${right.right_id}/edit`}
                        className="text-bark hover:text-copper-dark p-1"
                        title="Edit right"
                      >
                        <Edit2 size={14} />
                      </Link>
                      {!readOnly && (
                        <button
                          onClick={() => handleDelete(right.right_id)}
                          disabled={deleteMutation.isPending}
                          className="text-semantic-error hover:text-semantic-error/80 p-1 disabled:opacity-50"
                          title="Delete right"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Right SlideOver */}
      <AddRightSlideOver
        isOpen={showSlideOver}
        organizationId={organizationId}
        objectId={objectId}
        onClose={() => setShowSlideOver(false)}
        onSuccess={() => {
          setShowSlideOver(false);
          queryClient.invalidateQueries({ queryKey: ['object-rights', organizationId, objectId] });
        }}
      />

      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget);
          setDeleteTarget(null);
        }}
        title="Delete Rights Record"
        message="Are you sure you want to delete this rights record?"
        confirmText="Delete"
        confirmStyle="danger"
      />
    </div>
  );
}

// Add Right SlideOver
interface AddRightSlideOverProps {
  isOpen: boolean;
  organizationId: string;
  objectId: string;
  onClose: () => void;
  onSuccess: () => void;
}

function AddRightSlideOver({
  isOpen,
  organizationId,
  objectId,
  onClose,
  onSuccess,
}: AddRightSlideOverProps) {
  const [rightType, setRightType] = useState('copyright');
  const [status, setStatus] = useState('unknown');
  const [rightsHolderContactId, setRightsHolderContactId] = useState('');
  const [territory, setTerritory] = useState('');
  const [isPerpetual, setIsPerpetual] = useState(false);
  const [endDate, setEndDate] = useState('');
  const [usageConditions, setUsageConditions] = useState('');
  const [rightNote, setRightNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showContactSelector, setShowContactSelector] = useState(false);

  // Fetch rights holder contact details
  const { data: rightsHolderContact } = useQuery({
    queryKey: ['contact', organizationId, rightsHolderContactId],
    queryFn: () => getContact(organizationId, rightsHolderContactId),
    enabled: !!organizationId && !!rightsHolderContactId,
  });

  // Create right mutation
  const createMutation = useMutation({
    mutationFn: () => createObjectRight(organizationId, objectId, {
      right_type: rightType,
      status,
      rights_holder_contact_id: rightsHolderContactId || null,
      territory: territory || undefined,
      is_perpetual: isPerpetual,
      end_date: endDate || undefined,
      usage_conditions: usageConditions || undefined,
      right_note: rightNote || undefined,
    }),
    onSuccess: () => {
      // Reset form
      setRightType('copyright');
      setStatus('unknown');
      setRightsHolderContactId('');
      setTerritory('');
      setIsPerpetual(false);
      setEndDate('');
      setUsageConditions('');
      setRightNote('');
      onSuccess();
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const handleSubmit = () => {
    setError(null);
    createMutation.mutate();
  };

  return (
    <>
    <SlideOver
      isOpen={isOpen}
      onClose={onClose}
      title="Add Right"
      subtitle="Create a new rights record for this object"
      width="md"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-secondary">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={createMutation.isPending}
            className="btn btn-primary"
          >
            {createMutation.isPending ? (
              <>
                <Loader2 size={16} className="animate-spin mr-2" />
                Adding...
              </>
            ) : (
              'Add Right'
            )}
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        {error && (
          <div className="p-3 bg-semantic-error/10 border border-semantic-error/30 rounded-lg text-sm text-semantic-error">
            {error}
          </div>
        )}

        {/* Right Type */}
        <div>
          <label className="block text-sm font-medium text-ink mb-1.5">
            Right Type <span className="text-semantic-error">*</span>
          </label>
          <select
            value={rightType}
            onChange={(e) => setRightType(e.target.value)}
            className="input w-full"
          >
            {RIGHT_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Status */}
        <div>
          <label className="block text-sm font-medium text-ink mb-1.5">
            Status <span className="text-semantic-error">*</span>
          </label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="input w-full"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Rights Holder */}
        <div>
          <label className="block text-sm font-medium text-ink mb-1.5">
            Rights Holder
          </label>
          {rightsHolderContactId && rightsHolderContact ? (
            <div className="flex items-center justify-between p-3 bg-stone/30 rounded-lg">
              <div>
                <p className="font-medium text-ink">{rightsHolderContact.name}</p>
                {rightsHolderContact.organization_name && (
                  <p className="text-sm text-archive">{rightsHolderContact.organization_name}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setRightsHolderContactId('')}
                className="text-archive hover:text-ink"
              >
                <X size={18} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowContactSelector(true)}
              className="w-full p-3 border border-dashed border-lichen rounded-lg text-archive hover:border-bark hover:text-ink transition-colors"
            >
              + Select Rights Holder
            </button>
          )}
        </div>

        {/* Territory */}
        <div>
          <label className="block text-sm font-medium text-ink mb-1.5">
            Territory
          </label>
          <input
            type="text"
            value={territory}
            onChange={(e) => setTerritory(e.target.value)}
            placeholder="e.g., Worldwide, United States"
            className="input w-full"
          />
        </div>

        {/* Duration */}
        <div className="space-y-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox
              checked={isPerpetual}
              onChange={(e) => setIsPerpetual(e.target.checked)}
            />
            <span className="text-sm text-ink">Perpetual (no end date)</span>
          </label>

          {!isPerpetual && (
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">
                End Date
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="input w-full"
              />
            </div>
          )}
        </div>

        {/* Usage Conditions */}
        <div>
          <label className="block text-sm font-medium text-ink mb-1.5">
            Usage Conditions
          </label>
          <textarea
            value={usageConditions}
            onChange={(e) => setUsageConditions(e.target.value)}
            placeholder="Conditions for usage..."
            rows={2}
            className="input w-full"
          />
        </div>

        {/* Notes */}
        <div>
          <label className="block text-sm font-medium text-ink mb-1.5">
            Notes
          </label>
          <textarea
            value={rightNote}
            onChange={(e) => setRightNote(e.target.value)}
            placeholder="Additional notes..."
            rows={2}
            className="input w-full"
          />
        </div>
      </div>

      {/* Rights Holder Contact Selector */}
      <ContactSelectorSlideOver
        isOpen={showContactSelector}
        organizationId={organizationId}
        onClose={() => setShowContactSelector(false)}
        onSelect={(contactId) => {
          setRightsHolderContactId(contactId);
          setShowContactSelector(false);
        }}
        title="Select Rights Holder"
        subtitle="Search for an existing contact or create a new one"
        constituentTypes={['person', 'organization', 'estate']}
      />
    </SlideOver>
    </>
  );
}

export default ObjectRightsManager;
