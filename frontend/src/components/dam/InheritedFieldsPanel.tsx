import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Link2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import { getMediaInheritedFields } from '../../lib/api';

interface InheritedFieldsPanelProps {
  organizationId: string;
  mediaId: string;
  context?: 'detail' | 'list';
}

interface InheritedField {
  source_field: string;
  display_label: string;
  value: unknown;
}

interface InheritedObjectFields {
  object_id: string;
  object_number: string;
  fields: InheritedField[];
}

export function InheritedFieldsPanel({
  organizationId,
  mediaId,
  context = 'detail',
}: InheritedFieldsPanelProps) {
  const [expandedObjects, setExpandedObjects] = useState<Set<string>>(new Set());

  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ['media-inherited-fields', organizationId, mediaId, context],
    queryFn: () => getMediaInheritedFields(organizationId, mediaId, context),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  const toggleObject = (objectId: string) => {
    setExpandedObjects((prev) => {
      const next = new Set(prev);
      if (next.has(objectId)) {
        next.delete(objectId);
      } else {
        next.add(objectId);
      }
      return next;
    });
  };

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-3">
        <div className="h-6 bg-stone/30 rounded w-1/3" />
        <div className="h-20 bg-stone/30 rounded" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-semantic-error/10 border border-semantic-error/20 rounded-md text-semantic-error flex items-center gap-2">
        <AlertCircle size={16} />
        <span>Failed to load inherited fields</span>
      </div>
    );
  }

  const inheritedFields = data?.inherited_fields || [];

  if (inheritedFields.length === 0) {
    return null; // Don't show panel if no linked objects
  }

  const singleObject = inheritedFields.length === 1;

  return (
    <div className="border border-lichen rounded-lg overflow-hidden bg-parchment">
      {/* Header */}
      <div className="px-4 py-3 bg-stone/20 border-b border-lichen flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link2 size={16} className="text-archive" />
          <h3 className="font-medium text-ink text-sm">
            Linked Collection {inheritedFields.length === 1 ? 'Object' : 'Objects'}
          </h3>
          <span className="text-xs text-archive bg-stone/30 px-1.5 py-0.5 rounded">
            {inheritedFields.length}
          </span>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isRefetching}
          className="p-1 text-archive hover:text-ink hover:bg-stone/20 rounded transition-colors disabled:opacity-50"
          title="Refresh"
          aria-label="Refresh inherited fields"
        >
          <RefreshCw size={14} className={isRefetching ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Content */}
      <div className="divide-y divide-lichen">
        {inheritedFields.map((obj: InheritedObjectFields) => {
          const isExpanded = singleObject || expandedObjects.has(obj.object_id);

          return (
            <div key={obj.object_id} className="bg-parchment">
              {/* Object Header (collapsible if multiple objects) */}
              {!singleObject ? (
                <button
                  onClick={() => toggleObject(obj.object_id)}
                  className="w-full px-4 py-2 flex items-center justify-between hover:bg-stone/20 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    {isExpanded ? (
                      <ChevronDown size={14} className="text-archive" />
                    ) : (
                      <ChevronRight size={14} className="text-archive" />
                    )}
                    <span className="text-sm font-medium text-ink">
                      {obj.object_number}
                    </span>
                  </div>
                  <a
                    href={`/organizations/${organizationId}/collections/objects/${obj.object_id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="p-1 text-archive hover:text-bark transition-colors"
                    title="View object"
                  >
                    <ExternalLink size={12} />
                  </a>
                </button>
              ) : (
                <div className="px-4 py-2 flex items-center justify-between">
                  <span className="text-sm font-medium text-ink">
                    {obj.object_number}
                  </span>
                  <a
                    href={`/organizations/${organizationId}/collections/objects/${obj.object_id}`}
                    className="text-xs text-bark hover:text-copper-dark flex items-center gap-1 transition-colors"
                  >
                    View object
                    <ExternalLink size={10} />
                  </a>
                </div>
              )}

              {/* Fields */}
              {isExpanded && (
                <div className="px-4 pb-3 space-y-2">
                  {obj.fields.map((field: InheritedField, index: number) => (
                    <div key={index} className="flex flex-col gap-0.5">
                      <span className="text-xs text-archive">{field.display_label}</span>
                      <span className="text-sm text-ink">
                        {formatFieldValue(field.value)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatFieldValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '-';
  }
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  if (Array.isArray(value)) {
    return value.join(', ');
  }
  return String(value);
}
