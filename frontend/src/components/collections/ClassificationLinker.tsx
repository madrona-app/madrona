import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { getObjectClassifications, linkObjectClassification, unlinkObjectClassification } from '../../lib/api/collections';
import { useLookupCategory } from '../../hooks/useLookupValues';

interface ClassificationLinkerProps {
  organizationId: string;
  objectId: string;
  isEditing?: boolean;
}

export function ClassificationLinker({
  organizationId,
  objectId,
  isEditing = false,
}: ClassificationLinkerProps) {
  const queryClient = useQueryClient();
  const queryKey = ['object-classifications', organizationId, objectId];

  const { data: linked = [], isLoading } = useQuery({
    queryKey,
    queryFn: () => getObjectClassifications(organizationId, objectId),
  });

  // useLookupCategory returns options with value_key as `value`, but we need value_id for the API.
  // Use the raw `values` array which includes both value_id and value_key.
  const { values: classificationValues } = useLookupCategory('classification');

  const linkMutation = useMutation({
    mutationFn: (valueId: string) => linkObjectClassification(organizationId, objectId, { value_id: valueId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const unlinkMutation = useMutation({
    mutationFn: (linkId: string) => unlinkObjectClassification(organizationId, objectId, linkId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  // Filter out already-linked classifications
  const linkedValueIds = new Set((linked as any[]).map((l: any) => l.value_id));
  const availableOptions = classificationValues.filter(v => !linkedValueIds.has(v.value_id) && v.is_active);

  if (isLoading) {
    return <div className="text-sm text-archive">Loading classifications...</div>;
  }

  // Read-only mode
  if (!isEditing) {
    if (!(linked as any[]).length) return null;
    return (
      <div>
        <dt className="text-sm font-medium text-archive mb-2">Classifications</dt>
        <dd className="flex flex-wrap gap-2">
          {(linked as any[]).map((link: any) => (
            <span key={link.link_id} className="px-2 py-1 bg-stone/50 text-ink text-sm rounded">
              {link.lookup_value?.label || link.value_key || 'Unknown'}
            </span>
          ))}
        </dd>
      </div>
    );
  }

  // Edit mode
  return (
    <div>
      <label className="text-sm font-medium text-ink block mb-2">Classifications</label>

      {/* Current classifications as removable tags */}
      {(linked as any[]).length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {(linked as any[]).map((link: any) => (
            <span
              key={link.link_id}
              className="inline-flex items-center gap-1 px-2 py-1 bg-stone/50 text-ink text-sm rounded group"
            >
              {link.lookup_value?.label || link.value_key || 'Unknown'}
              <button
                type="button"
                onClick={() => unlinkMutation.mutate(link.link_id)}
                className="text-archive hover:text-semantic-error transition-colors"
                disabled={unlinkMutation.isPending}
              >
                <X size={14} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Add classification dropdown */}
      {availableOptions.length > 0 && (
        <select
          className="input w-full"
          value=""
          onChange={(e) => {
            if (e.target.value) {
              linkMutation.mutate(e.target.value);
              e.target.value = '';
            }
          }}
          disabled={linkMutation.isPending}
        >
          <option value="">Add classification...</option>
          {availableOptions.map(v => (
            <option key={v.value_id} value={v.value_id}>{v.label}</option>
          ))}
        </select>
      )}
    </div>
  );
}
