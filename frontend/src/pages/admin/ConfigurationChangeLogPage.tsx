/**
 * Security changes / Settings changes: the organization's configuration
 * history (roles and their permissions, field-access grants, per-app role
 * overrides, SSO, API keys; organization, media, workflow and template
 * settings). Each row is one recorded change with who made it; "Show changes"
 * reveals the field-by-field before and after. Secrets are never recorded,
 * so masked values read "(hidden)".
 */
import { Fragment, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, History } from 'lucide-react';
import {
  getEntityAuditEvents,
  getEntityAuditEventDetail,
  type EntityAuditEvent,
} from '../../lib/api';
import { FieldDiffList } from '../../components/audit';
import { formatDateTime } from '@/lib/formatters';

export type ChangeLogCategory = 'security' | 'settings';

/** Record types per log, with the names staff see. */
const CHANGE_LOG_TYPES: Record<ChangeLogCategory, Record<string, string>> = {
  security: {
    role: 'Role',
    app_role_assignment: 'App role override',
    sso_configuration: 'Single sign-on',
    api_key: 'API key',
  },
  settings: {
    organization: 'Organization settings',
    organization_branding: 'Branding and letterhead',
    organization_collection_profile: 'Collection profile',
    organization_storage_config: 'Storage',
    media_ai_config: 'Media AI settings',
    media_ai_tag_mapping: 'AI tag mapping',
    derivative_size_config: 'Derivative size',
    media_field_inheritance_config: 'Media field inheritance',
    vocabulary_mapping: 'Vocabulary mapping',
    sla_policy: 'Service level policy',
    approval_rule: 'Approval rule',
    document_template: 'Document template',
    org_scoped_doc: 'Help page',
  },
};

const PAGE_TEXT: Record<ChangeLogCategory, { title: string; intro: string; caption: string }> = {
  security: {
    title: 'Security Changes',
    intro:
      'Every change to roles and their permissions, field access, role labels, per-app role overrides, single sign-on and API keys, with who made it. Secrets such as client secrets, certificates and API keys are never recorded and show as (hidden).',
    caption: 'Security configuration changes, newest first',
  },
  settings: {
    title: 'Settings Changes',
    intro:
      'Every change to organization settings, enabled applications, branding, storage, media processing, vocabulary mappings, service levels, approval rules and document templates, with who made it. Stored credentials are never recorded and show as (hidden).',
    caption: 'Organization settings changes, newest first',
  },
};

const CHANGE_LABELS: Record<string, string> = {
  created: 'Created',
  updated: 'Updated',
  deleted: 'Deleted',
  link_added: 'Added',
  link_removed: 'Removed',
  link_updated: 'Changed',
};

const LIMIT = 50;

const selectClass =
  'w-full min-h-[44px] px-3 py-1.5 text-sm border border-lichen rounded-lg bg-parchment text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2';
const buttonClass =
  'inline-flex items-center gap-1 min-h-[44px] px-3 py-1.5 text-sm text-bark border border-lichen rounded hover:bg-stone hover:text-copper-dark disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2';

function EventDetails({ orgId, event }: { orgId: string; event: EntityAuditEvent }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['entityAuditEventDetail', orgId, event.event_id],
    queryFn: () => getEntityAuditEventDetail(orgId, event.event_id),
  });
  if (isLoading) return <p className="text-sm text-archive">Loading changes…</p>;
  if (isError) return <p className="text-sm text-semantic-error">Could not load the changes.</p>;
  const diffs = data?.event?.field_diffs ?? [];
  if (diffs.length === 0) return <p className="text-sm text-archive">No field details were recorded.</p>;
  return <FieldDiffList diffs={diffs} />;
}

function EventRow({ orgId, event, typeLabels }: {
  orgId: string; event: EntityAuditEvent & { child_display_key?: string | null }; typeLabels: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const detailsId = `change-log-details-${event.event_id}`;
  const recordName = event.entity_display_key || 'Unnamed record';
  const typeLabel = typeLabels[event.entity_type] ?? event.entity_type.replace(/_/g, ' ');
  const who = event.changed_by_name || event.changed_by_email || 'System';
  return (
    <Fragment>
      <tr className="border-b border-lichen align-top">
        <td className="px-3 py-2 text-sm text-archive whitespace-nowrap">{formatDateTime(event.changed_at)}</td>
        <td className="px-3 py-2 text-sm text-ink">{who}</td>
        <td className="px-3 py-2 text-sm text-archive">{typeLabel}</td>
        <th scope="row" className="px-3 py-2 text-sm font-medium text-ink text-left">{recordName}</th>
        <td className="px-3 py-2 text-sm text-ink">
          <span className="font-medium">{CHANGE_LABELS[event.change_type] ?? event.change_type}</span>
          {event.summary ? <span className="block text-archive">{event.summary}</span> : null}
        </td>
        <td className="px-3 py-2 text-right">
          <button
            type="button"
            className={buttonClass}
            aria-expanded={open}
            aria-controls={detailsId}
            aria-label={`${open ? 'Hide' : 'Show'} changes for ${typeLabel} ${recordName}, ${formatDateTime(event.changed_at)}`}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? 'Hide changes' : 'Show changes'}
          </button>
        </td>
      </tr>
      <tr id={detailsId} hidden={!open} className="border-b border-lichen bg-stone/20">
        <td colSpan={6} className="px-3 py-3">
          {open ? <EventDetails orgId={orgId} event={event} /> : null}
        </td>
      </tr>
    </Fragment>
  );
}

export default function ConfigurationChangeLogPage({ category }: { category: ChangeLogCategory }) {
  const { orgId } = useParams<{ orgId: string }>();
  const text = PAGE_TEXT[category];
  const typeLabels = CHANGE_LOG_TYPES[category];
  const [entityType, setEntityType] = useState('');
  const [changeType, setChangeType] = useState('');
  const [offset, setOffset] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const params = {
    category,
    ...(entityType && { entity_type: entityType }),
    ...(changeType && { change_type: changeType }),
    limit: LIMIT,
    offset,
  };
  const { data, isLoading, isError } = useQuery({
    queryKey: ['configurationChangeLog', orgId, params],
    queryFn: () => getEntityAuditEvents(orgId!, params),
    enabled: !!orgId,
  });
  const events = data?.items ?? [];
  const total = data?.total ?? 0;
  const hasPrev = offset > 0;
  const hasMore = offset + LIMIT < total;

  const status = isLoading
    ? 'Loading changes…'
    : isError
      ? ''
      : total === 0
        ? 'No changes recorded.'
        : `Showing ${offset + 1} to ${Math.min(offset + LIMIT, total)} of ${total} changes.`;

  const typeId = `change-log-${category}-type`;
  const changeId = `change-log-${category}-change`;

  return (
    <div className="p-8">
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <History size={24} className="text-bark" aria-hidden="true" />
          <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-semibold text-ink focus:outline-none">{text.title}</h1>
        </div>
        <p className="text-sm text-archive max-w-3xl">{text.intro}</p>
      </div>

      <form
        className="bg-parchment border border-lichen rounded-lg p-4 mb-6 grid grid-cols-1 sm:grid-cols-2 gap-4"
        aria-label={`Filter ${text.title.toLowerCase()}`}
        onSubmit={(e) => e.preventDefault()}
      >
        <div>
          <label htmlFor={typeId} className="block text-sm text-ink mb-1">Record type</label>
          <select id={typeId} className={selectClass} value={entityType}
            onChange={(e) => { setEntityType(e.target.value); setOffset(0); }}>
            <option value="">All record types</option>
            {Object.entries(typeLabels).sort(([, a], [, b]) => a.localeCompare(b)).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={changeId} className="block text-sm text-ink mb-1">Change</label>
          <select id={changeId} className={selectClass} value={changeType}
            onChange={(e) => { setChangeType(e.target.value); setOffset(0); }}>
            <option value="">All changes</option>
            <option value="created">Created</option>
            <option value="updated">Updated</option>
            <option value="deleted">Deleted</option>
            <option value="link_added">Added (permissions, grants, labels)</option>
            <option value="link_removed">Removed (permissions, grants, labels)</option>
            <option value="link_updated">Changed (permissions, grants, labels)</option>
          </select>
        </div>
      </form>

      <p role="status" className="text-sm text-archive mb-2">{status}</p>
      {isError ? (
        <p role="alert" className="text-sm text-semantic-error mb-4">Could not load the change log. Please try again.</p>
      ) : null}

      {events.length > 0 ? (
        <div className="bg-parchment border border-lichen rounded-lg overflow-x-auto">
          <table className="w-full">
            <caption className="sr-only">{text.caption}</caption>
            <thead className="bg-stone/40 border-b border-lichen">
              <tr>
                <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-archive uppercase tracking-wide">When</th>
                <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-archive uppercase tracking-wide">Who</th>
                <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-archive uppercase tracking-wide">Record type</th>
                <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-archive uppercase tracking-wide">Record</th>
                <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-archive uppercase tracking-wide">Change</th>
                <th scope="col" className="px-3 py-2 text-right text-xs font-medium text-archive uppercase tracking-wide">Details</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <EventRow key={event.event_id} orgId={orgId!} event={event} typeLabels={typeLabels} />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {(hasPrev || hasMore) && (
        <nav aria-label={`${text.title} pages`} className="flex items-center justify-between mt-4">
          <button type="button" className={buttonClass} disabled={!hasPrev}
            onClick={() => { setOffset(Math.max(0, offset - LIMIT)); headingRef.current?.focus(); }}>
            <ChevronLeft size={16} aria-hidden="true" /> Previous
          </button>
          <button type="button" className={buttonClass} disabled={!hasMore}
            onClick={() => { setOffset(offset + LIMIT); headingRef.current?.focus(); }}>
            Next <ChevronRight size={16} aria-hidden="true" />
          </button>
        </nav>
      )}
    </div>
  );
}

export function SecurityChangesPage() {
  return <ConfigurationChangeLogPage category="security" />;
}

export function SettingsChangesPage() {
  return <ConfigurationChangeLogPage category="settings" />;
}
