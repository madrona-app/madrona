import { useQuery } from '@tanstack/react-query';
import { useState, useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { getEntity } from '../../lib/api';
import { EntityHistoryTab } from '../../components/EntityHistoryTab';
import { EntityRelationshipsTab } from '../../components/EntityRelationshipsTab';
import { useOrganization } from '../../contexts/useOrganization';
import { useProjectionConfig } from '../../hooks/useProjectionConfig';
import { resolveEntityDisplayFields } from '../../lib/projectionResolver';
import { MadronaLoader } from '../../components/ui/MadronaLoader';
import { formatDateTime, formatDateShort } from '@/lib/formatters';

export default function EntityDetailPage() {
  const { orgId, entityKey } = useParams<{ orgId: string; entityKey: string }>();
  const { activeOrganizationId } = useOrganization();
  const organizationId = orgId || activeOrganizationId;
  const [searchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as 'canonical' | 'history' | 'relationships' | null;
  const [activeTab, setActiveTab] = useState<'canonical' | 'history' | 'relationships'>(
    tabParam || 'canonical'
  );

  const { data: entity } = useQuery({
    queryKey: ['entity', entityKey, organizationId],
    queryFn: () => getEntity(entityKey!, organizationId ?? ''),
    enabled: !!entityKey && !!organizationId,
  });

  // Fetch org-level projection config for display field resolution
  const { config: orgProjectionConfig } = useProjectionConfig(organizationId ?? undefined);

  // Resolve display fields using org-level canonical display config
  const displayFields = useMemo(() => {
    if (!entity) return null;
    return resolveEntityDisplayFields(
      entity,
      'entity_detail',
      null,
      orgProjectionConfig
    );
  }, [entity, orgProjectionConfig]);

  // Extract canonical fields from payload for detail display
  interface CanonicalFields {
    id: string | undefined;
    type: string | undefined;
    label: string | undefined;
    description: string | undefined;
    status: string | undefined;
    identifiers: Array<{ scheme: string; value: string }> | undefined;
    classifications: Array<{ scheme?: string; term?: string; label?: string }> | undefined;
    properties: Record<string, unknown> | undefined;
    dates: Record<string, string> | undefined;
    relationships: Array<{ type: string; target: string; label?: string }> | undefined;
    media: Array<{ id?: string; type?: string; url?: string; thumbnail_url?: string; role?: string; label?: string }> | undefined;
    rights: string | Record<string, unknown> | undefined;
    provenance: { source?: { system?: string; recordId?: string }; ingestedAt?: string } | undefined;
    meta: { schemaVersion?: string; createdAt?: string; updatedAt?: string } | undefined;
  }

  const canonicalFields = useMemo((): CanonicalFields | null => {
    if (!entity?.payload) return null;
    const p = entity.payload as Record<string, unknown>;
    return {
      id: p.id as string | undefined,
      type: p.type as string | undefined,
      label: p.label as string | undefined,
      description: p.description as string | undefined,
      status: p.status as string | undefined,
      identifiers: p.identifiers as Array<{ scheme: string; value: string }> | undefined,
      classifications: p.classifications as Array<{ scheme?: string; term?: string; label?: string }> | undefined,
      properties: p.properties as Record<string, unknown> | undefined,
      dates: p.dates as Record<string, string> | undefined,
      relationships: p.relationships as Array<{ type: string; target: string; label?: string }> | undefined,
      media: p.media as Array<{ id?: string; type?: string; url?: string; thumbnail_url?: string; role?: string; label?: string }> | undefined,
      rights: p.rights as string | Record<string, unknown> | undefined,
      provenance: p.provenance as { source?: { system?: string; recordId?: string }; ingestedAt?: string } | undefined,
      meta: p.meta as { schemaVersion?: string; createdAt?: string; updatedAt?: string } | undefined,
    };
  }, [entity]);

  // Helper to safely render a value that might be an object
  const renderValue = (value: unknown): string => {
    if (value === null || value === undefined) return '—';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) {
      // Array of primitives: join with commas
      if (value.length > 0 && typeof value[0] !== 'object') {
        return value.map(v => renderValue(v)).join(', ');
      }
      // Array of objects: summarize each by its most useful field
      return value.map(v => {
        if (typeof v !== 'object' || v === null) return String(v);
        const obj = v as Record<string, unknown>;
        // Pick the best label: name, title, display_name, file_name, or first string value
        const label = obj.title || obj.name || obj.display_name || obj.file_name || obj.number;
        if (label) return String(label);
        // Fallback: first non-null string value
        const firstStr = Object.values(obj).find(val => typeof val === 'string' && val);
        return firstStr ? String(firstStr) : JSON.stringify(obj);
      }).join('; ');
    }
    if (typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      // Object with mostly null values: show only non-null fields
      const nonNull = Object.entries(obj).filter(([, v]) => v !== null && v !== undefined);
      if (nonNull.length === 0) return '—';
      return nonNull.map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join(', ');
    }
    return String(value);
  };

  if (!entity || !displayFields) {
    return <div className="text-center py-12"><MadronaLoader /></div>;
  }

  // Use resolved display fields from projection config
  const { title, subtitle, thumbnailUrl } = displayFields;

  return (
    <div className="space-y-6">
      {/* Header - projection-driven fields */}
      <div className="bg-parchment p-6 rounded-lg shadow">
        <div className="flex gap-6">
          {thumbnailUrl && (
            <img
              src={thumbnailUrl}
              alt={title}
              className="w-48 h-48 object-cover rounded-lg"
              onError={(e) => {
                // Hide broken images gracefully
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          )}
          <div className="flex-1 space-y-4">
            <div>
              <h1 className="text-2xl font-semibold text-ink">{title}</h1>
              {subtitle && (
                <p className="text-sm text-archive mt-1">{subtitle}</p>
              )}
              <p className="text-xs text-archive mt-1">Entity Key: {entity.entity_key}</p>
            </div>

            {/* Canonical detail fields */}
            {canonicalFields && (
              <div className="space-y-4">
                {/* Description */}
                {canonicalFields.description && (
                  <div>
                    <p className="text-sm font-medium text-archive">Description</p>
                    <p className="text-base text-ink mt-1">{canonicalFields.description}</p>
                  </div>
                )}

                {/* Key metadata grid */}
                <div className="grid grid-cols-2 gap-4">
                  {canonicalFields.type && (
                    <div>
                      <p className="text-sm text-archive">Type</p>
                      <p className="text-base font-medium text-ink">{canonicalFields.type}</p>
                    </div>
                  )}
                  {canonicalFields.status && (
                    <div>
                      <p className="text-sm text-archive">Status</p>
                      <p className="text-base font-medium text-ink">{canonicalFields.status}</p>
                    </div>
                  )}
                  {entity.fields?.object_number && (
                    <div>
                      <p className="text-sm text-archive">Object Number</p>
                      <p className="text-base font-medium text-ink">{entity.fields.object_number}</p>
                    </div>
                  )}
                  {entity.fields?.modified_at && (
                    <div>
                      <p className="text-sm text-archive">Modified At</p>
                      <p className="text-base font-medium text-ink">
                        {formatDateTime(entity.fields.modified_at)}
                      </p>
                    </div>
                  )}
                </div>

                {/* Identifiers */}
                {canonicalFields.identifiers && canonicalFields.identifiers.length > 0 && (
                  <div>
                    <p className="text-sm font-medium text-archive mb-2">Identifiers</p>
                    <div className="flex flex-wrap gap-2">
                      {canonicalFields.identifiers.map((id, i) => (
                        <span key={i} className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium bg-stone text-ink">
                          <span className="text-archive mr-1">{id.scheme}:</span>
                          {id.value}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Classifications */}
                {canonicalFields.classifications && canonicalFields.classifications.length > 0 && (
                  <div>
                    <p className="text-sm font-medium text-archive mb-2">Classifications</p>
                    <div className="flex flex-wrap gap-2">
                      {canonicalFields.classifications.map((c, i) => (
                        <span key={i} className="badge-info-subtle">
                          {c.label || c.term || c.scheme}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Dates */}
                {canonicalFields.dates && Object.keys(canonicalFields.dates).length > 0 && (
                  <div>
                    <p className="text-sm font-medium text-archive mb-2">Dates</p>
                    <div className="grid grid-cols-2 gap-2">
                      {Object.entries(canonicalFields.dates).map(([key, value]) => (
                        <div key={key}>
                          <p className="text-xs text-archive capitalize">{key.replace(/_/g, ' ')}</p>
                          <p className="text-sm text-ink">{renderValue(value)}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Properties */}
                {canonicalFields.properties && Object.keys(canonicalFields.properties).length > 0 && (
                  <div>
                    <p className="text-sm font-medium text-archive mb-2">Properties</p>
                    <div className="grid grid-cols-2 gap-2">
                      {Object.entries(canonicalFields.properties).map(([key, value]) => (
                        <div key={key}>
                          <p className="text-xs text-archive capitalize">{key.replace(/_/g, ' ')}</p>
                          <p className="text-sm text-ink">{renderValue(value)}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Relationships */}
                {canonicalFields.relationships && canonicalFields.relationships.length > 0 && (
                  <div>
                    <p className="text-sm font-medium text-archive mb-2">Relationships</p>
                    <div className="space-y-1">
                      {canonicalFields.relationships.map((rel, i) => (
                        <div key={i} className="text-sm">
                          <span className="text-archive">{rel.type}:</span>{' '}
                          <span className="text-ink">{rel.label || rel.target}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Rights */}
                {canonicalFields.rights && (
                  <div>
                    <p className="text-sm font-medium text-archive">Rights</p>
                    <p className="text-sm text-ink mt-1">{renderValue(canonicalFields.rights)}</p>
                  </div>
                )}

                {/* Provenance */}
                {canonicalFields.provenance?.source && (
                  <div>
                    <p className="text-sm font-medium text-archive mb-1">Source</p>
                    <p className="text-sm text-ink">
                      {canonicalFields.provenance.source.system}
                      {canonicalFields.provenance.source.recordId && (
                        <span className="text-archive"> / {canonicalFields.provenance.source.recordId}</span>
                      )}
                    </p>
                  </div>
                )}

                {/* Media */}
                {canonicalFields.media && canonicalFields.media.length > 0 && (
                  <div>
                    <p className="text-sm font-medium text-archive mb-2">Media ({canonicalFields.media.length})</p>
                    <div className="flex gap-2 overflow-x-auto">
                      {canonicalFields.media.slice(0, 6).map((m, i) => (
                        (m.thumbnail_url || m.url) && (
                          <img
                            key={i}
                            // 80px slot: take the thumbnail when the payload
                            // offers one rather than the full display image.
                            src={m.thumbnail_url || m.url}
                            alt={m.label || `Media ${i + 1}`}
                            className="w-20 h-20 object-cover rounded border border-lichen"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                            }}
                          />
                        )
                      ))}
                    </div>
                  </div>
                )}

                {/* Schema info */}
                {canonicalFields.meta?.schemaVersion && (
                  <div className="pt-2 border-t border-lichen">
                    <p className="text-xs text-archive">
                      Schema v{canonicalFields.meta.schemaVersion}
                      {canonicalFields.meta.updatedAt && (
                        <> · Updated {formatDateShort(canonicalFields.meta.updatedAt)}</>
                      )}
                    </p>
                  </div>
                )}
              </div>
            )}

            {entity.canonical_url && (
              <div>
                <a
                  href={entity.canonical_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-secondary inline-flex items-center"
                >
                  View Original Source →
                </a>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-parchment rounded-lg shadow">
        <div className="border-b border-lichen">
          <nav className="-mb-px flex">
            <button
              onClick={() => setActiveTab('canonical')}
              className={`px-6 py-3 border-b-2 font-medium text-sm ${
                activeTab === 'canonical'
                  ? 'border-lichen text-ink'
                  : 'border-transparent text-archive hover:text-ink hover:border-lichen'
              }`}
            >
              Canonical JSON
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`px-6 py-3 border-b-2 font-medium text-sm ${
                activeTab === 'history'
                  ? 'border-lichen text-ink'
                  : 'border-transparent text-archive hover:text-ink hover:border-lichen'
              }`}
            >
              History
            </button>
            <button
              onClick={() => setActiveTab('relationships')}
              className={`px-6 py-3 border-b-2 font-medium text-sm ${
                activeTab === 'relationships'
                  ? 'border-lichen text-ink'
                  : 'border-transparent text-archive hover:text-ink hover:border-lichen'
              }`}
            >
              Relationships
            </button>
          </nav>
        </div>

        <div className="p-6">
          {activeTab === 'canonical' && (
            <pre className="bg-stone p-4 rounded-md overflow-x-auto text-sm">
              {JSON.stringify(entity.payload, null, 2)}
            </pre>
          )}

          {activeTab === 'history' && organizationId && (
            <EntityHistoryTab
              entityKey={entity.entity_key}
              organizationId={organizationId}
            />
          )}

          {activeTab === 'relationships' && organizationId && (
            <EntityRelationshipsTab
              entityKey={entity.entity_key}
              organizationId={organizationId}
            />
          )}
        </div>
      </div>
    </div>
  );
}
