import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle,
  XCircle,
  Server,
  Package,
  ChevronDown,
  ChevronRight,
  ShieldCheck,
  Activity,
  Archive,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  getMediaPreservationEvents,
  getMediaReplicas,
  getMediaInfoPackages,
  getAIPManifest,
} from '../../lib/api/preservation';
import type {
  RiskLevel,
  VerificationStatus,
  PreservationEvent,
  ReplicationRecord,
  InformationPackage,
} from '../../lib/api/preservation';
import { formatRelativeTime } from '@/lib/formatters';

// ── Risk badge helper ──────────────────────────────────────────────

const RISK_STYLES: Record<RiskLevel, string> = {
  critical: 'bg-semantic-error/10 text-semantic-error',
  high: 'bg-semantic-warning/10 text-semantic-warning',
  moderate: 'bg-bark/10 text-bark',
  low: 'bg-semantic-success/10 text-semantic-success',
  unknown: 'bg-stone text-archive',
};

function RiskBadge({ level }: { level: RiskLevel }) {
  return (
    <span className={cn('inline-flex px-2 py-0.5 text-xs font-medium rounded-full', RISK_STYLES[level])}>
      {level}
    </span>
  );
}

const VERIFICATION_STYLES: Record<VerificationStatus, string> = {
  verified: 'bg-semantic-success/10 text-semantic-success',
  mismatch: 'bg-semantic-error/10 text-semantic-error',
  unverified: 'bg-stone text-archive',
  missing: 'bg-semantic-error/10 text-semantic-error',
};

function VerificationBadge({ status }: { status: VerificationStatus }) {
  return (
    <span className={cn('inline-flex px-2 py-0.5 text-xs font-medium rounded-full', VERIFICATION_STYLES[status])}>
      {status}
    </span>
  );
}

// ── Event type icons ──────────────────────────────────────────────

const EVENT_ICONS: Record<string, typeof Activity> = {
  fixity_check: ShieldCheck,
  ingestion: Archive,
  migration: Activity,
  replication: Server,
  validation: CheckCircle,
  deletion: XCircle,
  format_identification: Package,
  message_digest_calculation: ShieldCheck,
};

const OUTCOME_STYLES: Record<string, string> = {
  success: 'bg-semantic-success/10 text-semantic-success',
  failure: 'bg-semantic-error/10 text-semantic-error',
  warning: 'bg-semantic-warning/10 text-semantic-warning',
};

// ── Helpers ────────────────────────────────────────────────────────

function formatRelativeDate(iso: string): string {
  return formatRelativeTime(iso);
}

// ── Component ──────────────────────────────────────────────────────

interface MediaPreservationTabProps {
  organizationId: string;
  mediaId: string;
  formatName?: string | null;
  pronomPuid?: string | null;
  formatRiskLevel?: string | null;
}

export default function MediaPreservationTab({
  organizationId,
  mediaId,
  formatName,
  pronomPuid,
  formatRiskLevel,
}: MediaPreservationTabProps) {
  const riskLevel = (formatRiskLevel || 'unknown') as RiskLevel;
  const showRiskAlert = riskLevel === 'high' || riskLevel === 'critical';

  // ── Queries ────────────────────────────────────────────────────

  const eventsQuery = useQuery({
    queryKey: ['preservation-events', organizationId, mediaId],
    queryFn: () => getMediaPreservationEvents(organizationId, mediaId, { limit: 50 }),
    staleTime: 60_000,
  });

  const replicasQuery = useQuery({
    queryKey: ['preservation-replicas', organizationId, mediaId],
    queryFn: () => getMediaReplicas(organizationId, mediaId),
    staleTime: 60_000,
  });

  const packagesQuery = useQuery({
    queryKey: ['preservation-packages', organizationId, mediaId],
    queryFn: () => getMediaInfoPackages(organizationId, mediaId),
    staleTime: 60_000,
  });

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Format & Fixity */}
      <section>
        <h3 className="text-sm font-semibold text-ink mb-3 flex items-center gap-2">
          <ShieldCheck size={16} className="text-forest" />
          Format &amp; Fixity
        </h3>

        {showRiskAlert && (
          <div className="mb-3 p-3 rounded-lg bg-semantic-warning/10 border border-semantic-warning/20 flex items-start gap-2">
            <AlertTriangle size={16} className="text-semantic-warning mt-0.5 shrink-0" />
            <p className="text-sm text-semantic-warning">
              This file has a <strong>{riskLevel}</strong> format risk level. Consider migrating to a more sustainable format.
            </p>
          </div>
        )}

        <div className="bg-stone/20 rounded-lg p-4 grid grid-cols-3 gap-4">
          <div>
            <p className="text-xs text-archive mb-1">Format</p>
            <p className="text-sm text-ink">{formatName || 'Unknown'}</p>
          </div>
          <div>
            <p className="text-xs text-archive mb-1">PRONOM PUID</p>
            <p className="text-sm text-ink font-mono">{pronomPuid || '—'}</p>
          </div>
          <div>
            <p className="text-xs text-archive mb-1">Risk Level</p>
            <RiskBadge level={riskLevel} />
          </div>
        </div>
      </section>

      {/* Preservation Events */}
      <section>
        <h3 className="text-sm font-semibold text-ink mb-3 flex items-center gap-2">
          <Activity size={16} className="text-forest" />
          Preservation Events
        </h3>

        {eventsQuery.isLoading && <LoadingSkeleton rows={3} />}
        {eventsQuery.error && <ErrorMessage message="Failed to load preservation events" />}
        {eventsQuery.data && (
          eventsQuery.data.items.length === 0 ? (
            <p className="text-sm text-archive">No preservation events recorded.</p>
          ) : (
            <EventTimeline events={eventsQuery.data.items} />
          )
        )}
      </section>

      {/* Storage Copies */}
      <section>
        <h3 className="text-sm font-semibold text-ink mb-3 flex items-center gap-2">
          <Server size={16} className="text-forest" />
          Storage Copies
        </h3>

        {replicasQuery.isLoading && <LoadingSkeleton rows={2} />}
        {replicasQuery.error && <ErrorMessage message="Failed to load replicas" />}
        {replicasQuery.data && (
          replicasQuery.data.replicas.length === 0 ? (
            <p className="text-sm text-archive">No replicas found.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {replicasQuery.data.replicas.map((r) => (
                <ReplicaCard key={r.record_id} replica={r} />
              ))}
            </div>
          )
        )}
      </section>

      {/* Information Packages */}
      <section>
        <h3 className="text-sm font-semibold text-ink mb-3 flex items-center gap-2">
          <Package size={16} className="text-forest" />
          Information Packages
        </h3>

        {packagesQuery.isLoading && <LoadingSkeleton rows={2} />}
        {packagesQuery.error && <ErrorMessage message="Failed to load information packages" />}
        {packagesQuery.data && (
          packagesQuery.data.items.length === 0 ? (
            <p className="text-sm text-archive">No information packages created.</p>
          ) : (
            <div className="space-y-2">
              {packagesQuery.data.items.map((pkg) => (
                <PackageRow
                  key={pkg.package_id}
                  pkg={pkg}
                  organizationId={organizationId}
                  mediaId={mediaId}
                />
              ))}
            </div>
          )
        )}
      </section>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────

function EventTimeline({ events }: { events: PreservationEvent[] }) {
  return (
    <div className="space-y-1">
      {events.map((event) => {
        const Icon = EVENT_ICONS[event.event_type] || Activity;
        return (
          <div key={event.event_id} className="flex items-start gap-3 py-2 border-b border-lichen/50 last:border-0">
            <div className="mt-0.5 p-1 rounded bg-stone/50">
              <Icon size={14} className="text-archive" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm text-ink font-medium">
                  {event.event_type.replace(/_/g, ' ')}
                </span>
                <span className={cn('inline-flex px-1.5 py-0.5 text-xs rounded-full', OUTCOME_STYLES[event.outcome])}>
                  {event.outcome}
                </span>
              </div>
              {event.outcome_detail && (
                <p className="text-xs text-archive mt-0.5 truncate">{event.outcome_detail}</p>
              )}
              <p className="text-xs text-archive mt-0.5">
                {event.agent_name} · {formatRelativeDate(event.created_at)}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ReplicaCard({ replica }: { replica: ReplicationRecord }) {
  return (
    <div className="p-3 rounded-lg border border-lichen bg-parchment/50">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-ink">{replica.storage_provider}</span>
        <VerificationBadge status={replica.verification_status} />
      </div>
      <div className="space-y-1 text-xs text-archive">
        <p>Region: {replica.storage_region}</p>
        <p>Type: {replica.copy_type}</p>
        {replica.last_verified_at && (
          <p>Verified: {formatRelativeDate(replica.last_verified_at)}</p>
        )}
      </div>
    </div>
  );
}

function PackageRow({
  pkg,
  organizationId,
  mediaId,
}: {
  pkg: InformationPackage;
  organizationId: string;
  mediaId: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const isAIP = pkg.package_type === 'AIP' && pkg.status === 'active';

  const manifestQuery = useQuery({
    queryKey: ['preservation-aip-manifest', organizationId, mediaId],
    queryFn: () => getAIPManifest(organizationId, mediaId),
    enabled: expanded && isAIP,
    staleTime: 5 * 60_000,
  });

  const typeStyles: Record<string, string> = {
    SIP: 'bg-semantic-info/10 text-semantic-info',
    AIP: 'bg-semantic-success/10 text-semantic-success',
    DIP: 'bg-bark/10 text-bark',
  };

  return (
    <div className="border border-lichen rounded-lg">
      <button
        onClick={() => isAIP && setExpanded(!expanded)}
        className={cn(
          'w-full flex items-center gap-3 px-3 py-2.5 text-left',
          isAIP && 'cursor-pointer hover:bg-stone/30',
        )}
      >
        {isAIP ? (
          expanded ? <ChevronDown size={14} className="text-archive" /> : <ChevronRight size={14} className="text-archive" />
        ) : (
          <span className="w-3.5" />
        )}
        <span className={cn('inline-flex px-2 py-0.5 text-xs font-medium rounded-full', typeStyles[pkg.package_type] || 'bg-stone text-archive')}>
          {pkg.package_type}
        </span>
        <span className="text-sm text-ink flex-1">{pkg.status}</span>
        {pkg.external_identifier && (
          <span className="text-xs text-archive font-mono truncate max-w-[200px]">{pkg.external_identifier}</span>
        )}
        <span className="text-xs text-archive">{formatRelativeDate(pkg.created_at)}</span>
      </button>

      {expanded && isAIP && (
        <div className="px-3 pb-3 border-t border-lichen">
          {manifestQuery.isLoading && <p className="text-xs text-archive py-2">Loading manifest…</p>}
          {manifestQuery.error && <p className="text-xs text-semantic-error py-2">Failed to load manifest</p>}
          {manifestQuery.data && (
            <pre className="mt-2 p-3 bg-forest/5 rounded text-xs text-ink overflow-x-auto max-h-80">
              {JSON.stringify(manifestQuery.data, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function LoadingSkeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-2 animate-pulse">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-10 bg-stone/30 rounded" />
      ))}
    </div>
  );
}

function ErrorMessage({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-semantic-error">
      <XCircle size={14} />
      {message}
    </div>
  );
}
