import { useState } from 'react';
import Checkbox from '../Checkbox';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Shield,
  Plus,
  Trash2,
  AlertTriangle,
  Mail,
  Phone,
  Users,
  MapPin,
  FileText,
  MessageSquare,
  Handshake,
  Eye,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { formatDateShort } from '../../lib/formatters';
import {
  getObjectNagpraAction,
  createNagpraAction,
  updateNagpraAction,
  deleteNagpraAction,
  getNagpraConsultationEvents,
  createNagpraConsultationEvent,
  deleteNagpraConsultationEvent,
} from '../../lib/api/collections';
import type { NagpraConsultationEvent } from '../../lib/schemas';
import ConfirmDialog from '../ConfirmDialog';

interface NagpraManagerProps {
  organizationId: string;
  objectId: string;
  readOnly?: boolean;
}

const STATUS_LABELS: Record<string, string> = {
  identified: 'Identified',
  under_review: 'Under Review',
  consultation: 'Consultation',
  notice_filed: 'Notice Filed',
  waiting_period: 'Waiting Period',
  approved_for_transfer: 'Approved for Transfer',
  transferred: 'Transferred',
  closed: 'Closed',
};

const STATUS_COLORS: Record<string, string> = {
  identified: 'bg-semantic-info/10 text-semantic-info',
  under_review: 'bg-semantic-warning/10 text-semantic-warning',
  consultation: 'bg-semantic-warning/10 text-semantic-warning',
  notice_filed: 'bg-semantic-info/10 text-semantic-info',
  waiting_period: 'bg-semantic-info/10 text-semantic-info',
  approved_for_transfer: 'bg-semantic-success/10 text-semantic-success',
  transferred: 'bg-semantic-success/10 text-semantic-success',
  closed: 'bg-archive/10 text-archive',
};

const CATEGORY_LABELS: Record<string, string> = {
  human_remains: 'Human Remains',
  associated_funerary_object: 'Associated Funerary Object',
  unassociated_funerary_object: 'Unassociated Funerary Object',
  sacred_object: 'Sacred Object',
  object_of_cultural_patrimony: 'Object of Cultural Patrimony',
  undetermined: 'Undetermined',
};

const ORIGIN_LABELS: Record<string, string> = {
  tribal_request: 'Tribal Request',
  staff_review: 'Staff Review',
  inadvertent_discovery: 'Inadvertent Discovery',
  collections_review: 'Collections Review',
  other: 'Other',
};

const CONSENT_LABELS: Record<string, string> = {
  restricted: 'Restricted',
  requested: 'Requested',
  granted: 'Granted',
  denied: 'Denied',
  conditional: 'Conditional',
};

const EVENT_TYPE_ICONS: Record<string, typeof Mail> = {
  letter: Mail,
  email: Mail,
  phone_call: Phone,
  meeting: Users,
  site_visit: MapPin,
  collections_access: Eye,
  document_shared: FileText,
  formal_notice: FileText,
  response_received: MessageSquare,
  agreement: Handshake,
  other: MessageSquare,
};

const EVENT_TYPE_LABELS: Record<string, string> = {
  letter: 'Letter',
  email: 'Email',
  phone_call: 'Phone Call',
  meeting: 'Meeting',
  site_visit: 'Site Visit',
  collections_access: 'Collections Access',
  document_shared: 'Document Shared',
  formal_notice: 'Formal Notice',
  response_received: 'Response Received',
  agreement: 'Agreement',
  other: 'Other',
};

const DIRECTION_LABELS: Record<string, string> = {
  outgoing: 'Outgoing',
  incoming: 'Incoming',
  mutual: 'Mutual',
};

export function NagpraManager({ organizationId, objectId, readOnly }: NagpraManagerProps) {
  const queryClient = useQueryClient();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showEventForm, setShowEventForm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showConsultationLog, setShowConsultationLog] = useState(false);

  // Fetch NAGPRA action for this object
  const { data: action, isLoading } = useQuery({
    queryKey: ['nagpra-action', organizationId, objectId],
    queryFn: () => getObjectNagpraAction(organizationId, objectId),
  });

  // Fetch consultation events when action exists
  const { data: eventsData } = useQuery({
    queryKey: ['nagpra-events', organizationId, action?.action_id],
    queryFn: () => getNagpraConsultationEvents(organizationId, action!.action_id),
    enabled: !!action?.action_id,
  });

  const events = eventsData?.consultation_events ?? [];

  // Create action mutation
  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      createNagpraAction(organizationId, objectId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nagpra-action', organizationId, objectId] });
      setShowCreateForm(false);
    },
  });

  // Update action mutation
  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      updateNagpraAction(organizationId, action!.action_id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nagpra-action', organizationId, objectId] });
    },
  });

  // Delete action mutation
  const deleteMutation = useMutation({
    mutationFn: () => deleteNagpraAction(organizationId, action!.action_id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nagpra-action', organizationId, objectId] });
      setShowDeleteConfirm(false);
    },
  });

  // Create event mutation
  const createEventMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      createNagpraConsultationEvent(organizationId, action!.action_id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nagpra-events', organizationId, action!.action_id] });
      setShowEventForm(false);
    },
  });

  // Delete event mutation
  const deleteEventMutation = useMutation({
    mutationFn: (eventId: string) =>
      deleteNagpraConsultationEvent(organizationId, action!.action_id, eventId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nagpra-events', organizationId, action!.action_id] });
    },
  });

  if (isLoading) {
    return <div className="text-sm text-archive">Loading NAGPRA data...</div>;
  }

  // Empty state — no NAGPRA action
  if (!action) {
    if (showCreateForm) {
      return <CreateActionForm onSubmit={(data) => createMutation.mutate(data)} onCancel={() => setShowCreateForm(false)} isSubmitting={createMutation.isPending} />;
    }

    return (
      <div className="border border-dashed border-lichen rounded-lg p-6 text-center">
        <Shield className="mx-auto mb-2 text-archive" size={24} />
        <p className="text-sm text-archive mb-3">No NAGPRA action on this object</p>
        {!readOnly && (
          <button
            onClick={() => setShowCreateForm(true)}
            className="btn-secondary text-sm px-4 py-2 inline-flex items-center gap-1.5"
          >
            <Plus size={14} />
            Create NAGPRA Action
          </button>
        )}
      </div>
    );
  }

  // Action exists — render details
  return (
    <div className="space-y-4">
      {/* Header row with status and hold */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono text-archive">{action.action_number}</span>
          <span className={`text-xs px-2 py-0.5 rounded ${STATUS_COLORS[action.status] || 'bg-archive/10 text-archive'}`}>
            {STATUS_LABELS[action.status] || action.status}
          </span>
          {action.hold_active && (
            <span className="text-xs px-2 py-0.5 rounded bg-semantic-error/10 text-semantic-error font-medium flex items-center gap-1">
              <AlertTriangle size={12} />
              Hold Active
            </span>
          )}
        </div>
        {!readOnly && (
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="text-archive hover:text-semantic-error transition-colors p-1"
            title="Delete NAGPRA action"
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>

      {/* Key fields grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <LabeledField label="Category" value={CATEGORY_LABELS[action.nagpra_category] || action.nagpra_category} />
        <LabeledField label="Origin" value={ORIGIN_LABELS[action.origin_type] || action.origin_type} />
        <LabeledField label="Affiliation Status" value={action.affiliation_status?.replace(/_/g, ' ')} />
        {action.group_reference && <LabeledField label="Group Reference" value={action.group_reference} />}
        {action.geographic_origin && <LabeledField label="Geographic Origin" value={action.geographic_origin} />}
        {action.site_name && <LabeledField label="Site" value={action.site_name} />}
      </div>

      {/* Duty of Care consent grid */}
      <div className="border-t border-lichen pt-3">
        <h4 className="text-xs font-medium text-archive mb-2 uppercase tracking-wider">Duty of Care</h4>
        <div className="grid grid-cols-3 gap-3">
          <ConsentField label="Display" value={action.display_consent} />
          <ConsentField label="Access" value={action.access_consent} />
          <ConsentField label="Research" value={action.research_consent} />
        </div>
      </div>

      {/* Status update (inline) */}
      {!readOnly && (
        <div className="border-t border-lichen pt-3">
          <div className="flex items-center gap-2">
            <label className="text-xs text-archive">Status:</label>
            <select
              value={action.status}
              onChange={(e) => updateMutation.mutate({ status: e.target.value })}
              className="text-xs border border-lichen rounded px-2 py-1 bg-parchment text-ink focus-visible:ring-2 ring-bark/30 ring-offset-2"
            >
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <label className="text-xs text-archive ml-4">Hold:</label>
            <button
              onClick={() => updateMutation.mutate({ hold_active: !action.hold_active })}
              className={`text-xs px-2 py-1 rounded border transition-colors ${
                action.hold_active
                  ? 'border-semantic-error/30 bg-semantic-error/10 text-semantic-error'
                  : 'border-lichen bg-parchment text-archive'
              }`}
            >
              {action.hold_active ? 'Release Hold' : 'Place Hold'}
            </button>
          </div>
        </div>
      )}

      {/* Consultation Log */}
      <div className="border-t border-lichen pt-3">
        <button
          onClick={() => setShowConsultationLog(!showConsultationLog)}
          className="flex items-center gap-2 text-sm font-medium text-ink hover:text-bark transition-colors w-full"
        >
          {showConsultationLog ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          Consultation Log
          {events.length > 0 && (
            <span className="text-xs text-archive font-normal">({events.length})</span>
          )}
        </button>

        {showConsultationLog && (
          <div className="mt-3 space-y-2">
            {!readOnly && (
              <div className="mb-3">
                {showEventForm ? (
                  <CreateEventForm
                    onSubmit={(data) => createEventMutation.mutate(data)}
                    onCancel={() => setShowEventForm(false)}
                    isSubmitting={createEventMutation.isPending}
                  />
                ) : (
                  <button
                    onClick={() => setShowEventForm(true)}
                    className="btn-secondary text-xs px-3 py-1.5 inline-flex items-center gap-1"
                  >
                    <Plus size={12} />
                    Add Event
                  </button>
                )}
              </div>
            )}

            {events.length === 0 && !showEventForm && (
              <p className="text-xs text-archive italic">No consultation events recorded.</p>
            )}

            {events.map((event: any) => (
              <ConsultationEventCard
                key={event.event_id}
                event={event}
                readOnly={readOnly}
                onDelete={() => deleteEventMutation.mutate(event.event_id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Delete confirmation */}
      <ConfirmDialog
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={() => deleteMutation.mutate()}
        title="Delete NAGPRA Action"
        message="This will permanently delete the NAGPRA action and all consultation events for this object. This cannot be undone."
        confirmText="Delete"
        confirmStyle="danger"
      />
    </div>
  );
}

// --- Sub-components ---

function LabeledField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <span className="text-xs text-archive block">{label}</span>
      <span className="text-sm text-ink capitalize">{value || '—'}</span>
    </div>
  );
}

function ConsentField({ label, value }: { label: string; value: string }) {
  const colorClass = value === 'granted'
    ? 'text-semantic-success'
    : value === 'denied'
      ? 'text-semantic-error'
      : value === 'restricted'
        ? 'text-semantic-warning'
        : 'text-archive';

  return (
    <div className="text-center">
      <span className="text-xs text-archive block">{label}</span>
      <span className={`text-xs font-medium ${colorClass}`}>
        {CONSENT_LABELS[value] || value}
      </span>
    </div>
  );
}

function ConsultationEventCard({
  event,
  readOnly,
  onDelete,
}: {
  event: NagpraConsultationEvent;
  readOnly?: boolean;
  onDelete: () => void;
}) {
  const Icon = EVENT_TYPE_ICONS[event.event_type] || MessageSquare;

  return (
    <div className="flex gap-3 p-3 bg-stone/30 rounded-lg group">
      <div className="flex-shrink-0 mt-0.5">
        <Icon size={16} className="text-archive" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-medium text-ink">{event.subject}</span>
          <span className="text-xs text-archive">
            {EVENT_TYPE_LABELS[event.event_type] || event.event_type}
          </span>
          <span className={`text-xs px-1.5 py-0.5 rounded ${
            event.direction === 'outgoing' ? 'bg-semantic-info/10 text-semantic-info'
            : event.direction === 'incoming' ? 'bg-semantic-success/10 text-semantic-success'
            : 'bg-archive/10 text-archive'
          }`}>
            {DIRECTION_LABELS[event.direction] || event.direction}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-archive">
          <span>{formatDateShort(event.event_date)}</span>
          {event.consulting_party_name && (
            <span>· {event.consulting_party_name}</span>
          )}
        </div>
        {event.description && (
          <p className="text-xs text-ink/70 mt-1 line-clamp-2">{event.description}</p>
        )}
        {event.follow_up_required && (
          <span className="inline-flex items-center gap-1 text-xs text-semantic-warning mt-1">
            <AlertTriangle size={10} />
            Follow-up {event.follow_up_date ? `by ${formatDateShort(event.follow_up_date)}` : 'required'}
          </span>
        )}
      </div>
      {!readOnly && (
        <button
          onClick={onDelete}
          className="flex-shrink-0 opacity-0 group-hover:opacity-100 text-archive hover:text-semantic-error transition-all p-1"
          title="Delete event"
        >
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
}

function CreateActionForm({
  onSubmit,
  onCancel,
  isSubmitting,
}: {
  onSubmit: (data: Record<string, unknown>) => void;
  onCancel: () => void;
  isSubmitting: boolean;
}) {
  const [originType, setOriginType] = useState('staff_review');
  const [category, setCategory] = useState('undetermined');
  const [note, setNote] = useState('');

  return (
    <div className="border border-lichen rounded-lg p-4 space-y-3">
      <h4 className="text-sm font-medium text-ink">Create NAGPRA Action</h4>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-archive block mb-1">Origin Type</label>
          <select
            value={originType}
            onChange={(e) => setOriginType(e.target.value)}
            className="w-full text-sm border border-lichen rounded px-2 py-1.5 bg-parchment text-ink focus-visible:ring-2 ring-bark/30 ring-offset-2"
          >
            {Object.entries(ORIGIN_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-xs text-archive block mb-1">Category</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full text-sm border border-lichen rounded px-2 py-1.5 bg-parchment text-ink focus-visible:ring-2 ring-bark/30 ring-offset-2"
          >
            {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="text-xs text-archive block mb-1">Notes (optional)</label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          className="w-full text-sm border border-lichen rounded px-2 py-1.5 bg-parchment text-ink focus-visible:ring-2 ring-bark/30 ring-offset-2"
        />
      </div>

      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={() => onSubmit({ origin_type: originType, nagpra_category: category, action_note: note || undefined })}
          disabled={isSubmitting}
          className="btn-primary text-sm px-4 py-1.5"
        >
          {isSubmitting ? 'Creating...' : 'Create'}
        </button>
        <button onClick={onCancel} className="btn-tertiary text-sm px-4 py-1.5">
          Cancel
        </button>
      </div>
    </div>
  );
}

function CreateEventForm({
  onSubmit,
  onCancel,
  isSubmitting,
}: {
  onSubmit: (data: Record<string, unknown>) => void;
  onCancel: () => void;
  isSubmitting: boolean;
}) {
  const [eventDate, setEventDate] = useState(new Date().toISOString().split('T')[0]);
  const [eventType, setEventType] = useState('meeting');
  const [direction, setDirection] = useState('outgoing');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [partyName, setPartyName] = useState('');
  const [followUp, setFollowUp] = useState(false);

  return (
    <div className="border border-lichen rounded-lg p-4 space-y-3">
      <h4 className="text-sm font-medium text-ink">Add Consultation Event</h4>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="text-xs text-archive block mb-1">Date</label>
          <input
            type="date"
            value={eventDate}
            onChange={(e) => setEventDate(e.target.value)}
            className="w-full text-sm border border-lichen rounded px-2 py-1.5 bg-parchment text-ink focus-visible:ring-2 ring-bark/30 ring-offset-2"
          />
        </div>
        <div>
          <label className="text-xs text-archive block mb-1">Type</label>
          <select
            value={eventType}
            onChange={(e) => setEventType(e.target.value)}
            className="w-full text-sm border border-lichen rounded px-2 py-1.5 bg-parchment text-ink focus-visible:ring-2 ring-bark/30 ring-offset-2"
          >
            {Object.entries(EVENT_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-archive block mb-1">Direction</label>
          <select
            value={direction}
            onChange={(e) => setDirection(e.target.value)}
            className="w-full text-sm border border-lichen rounded px-2 py-1.5 bg-parchment text-ink focus-visible:ring-2 ring-bark/30 ring-offset-2"
          >
            {Object.entries(DIRECTION_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="text-xs text-archive block mb-1">Consulting Party</label>
        <input
          type="text"
          value={partyName}
          onChange={(e) => setPartyName(e.target.value)}
          placeholder="Name of consulting party"
          className="w-full text-sm border border-lichen rounded px-2 py-1.5 bg-parchment text-ink placeholder:text-archive/50 focus-visible:ring-2 ring-bark/30 ring-offset-2"
        />
      </div>

      <div>
        <label className="text-xs text-archive block mb-1">Subject</label>
        <input
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Brief summary of the interaction"
          className="w-full text-sm border border-lichen rounded px-2 py-1.5 bg-parchment text-ink placeholder:text-archive/50 focus-visible:ring-2 ring-bark/30 ring-offset-2"
        />
      </div>

      <div>
        <label className="text-xs text-archive block mb-1">Description (optional)</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className="w-full text-sm border border-lichen rounded px-2 py-1.5 bg-parchment text-ink focus-visible:ring-2 ring-bark/30 ring-offset-2"
        />
      </div>

      <label className="flex items-center gap-2 text-sm text-ink">
        <Checkbox
          checked={followUp}
          onChange={(e) => setFollowUp(e.target.checked)}
        />
        Follow-up required
      </label>

      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={() => {
            if (!subject.trim()) return;
            onSubmit({
              event_date: eventDate,
              event_type: eventType,
              direction,
              subject: subject.trim(),
              description: description.trim() || undefined,
              consulting_party_name: partyName.trim() || undefined,
              follow_up_required: followUp,
            });
          }}
          disabled={isSubmitting || !subject.trim()}
          className="btn-primary text-sm px-4 py-1.5"
        >
          {isSubmitting ? 'Adding...' : 'Add Event'}
        </button>
        <button onClick={onCancel} className="btn-tertiary text-sm px-4 py-1.5">
          Cancel
        </button>
      </div>
    </div>
  );
}
