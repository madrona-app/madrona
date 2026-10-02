/**
 * Staff Grid Block — Team member grid from constituents.
 *
 * Editor: select specific constituent IDs or filter by department, configure columns.
 * Renderer: fetches from public staff API and renders a card grid.
 */

import Checkbox from '../../../../components/Checkbox';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Mail, User } from 'lucide-react';
import { getPublicStaff } from '../../../../lib/api/discover';
import { cn } from '../../../../lib/utils';

// =============================================================================
// Shared Types
// =============================================================================

interface BlockEditorComponentProps {
  content: Record<string, unknown>;
  onChange: (content: Record<string, unknown>) => void;
}

interface BlockRendererComponentProps {
  content: Record<string, unknown>;
}

const COLUMN_OPTIONS = [2, 3, 4] as const;

// =============================================================================
// Editor
// =============================================================================

export function StaffGridEditor({ content, onChange }: BlockEditorComponentProps) {
  const constituentIds = (content.constituent_ids as string[]) || [];
  const departmentFilter = (content.department_filter as string) || '';
  const columns = (content.columns as number) ?? 3;
  const showBio = (content.show_bio as boolean) ?? false;

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-medium text-ink mb-1">
          Department Filter
        </label>
        <input
          type="text"
          value={departmentFilter}
          onChange={(e) => onChange({ ...content, department_filter: e.target.value })}
          placeholder="e.g., Curatorial, Conservation (leave empty for all)"
          className="input w-full text-sm"
        />
        <p className="text-xs text-archive mt-1">
          Filter staff by department name, or leave empty to show all staff. Only people with a Madrona user account are listed.
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-ink mb-1">
          Specific People (optional)
        </label>
        <textarea
          value={constituentIds.join('\n')}
          onChange={(e) => {
            const ids = e.target.value
              .split('\n')
              .map((s) => s.trim())
              .filter(Boolean);
            onChange({ ...content, constituent_ids: ids });
          }}
          placeholder="Paste record UUIDs, one per line..."
          rows={3}
          className="input w-full text-sm resize-none font-mono"
        />
        <p className="text-xs text-archive mt-1">
          If provided, only these people will be shown (overrides department filter).
        </p>
      </div>

      <div className="flex items-end gap-4">
        <div>
          <label className="block text-sm font-medium text-ink mb-1">
            Columns
          </label>
          <div className="flex gap-2">
            {COLUMN_OPTIONS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => onChange({ ...content, columns: n })}
                className={cn(
                  'px-3 py-1.5 text-sm rounded-lg border transition-colors',
                  columns === n
                    ? 'border-bark bg-bark/10 text-bark'
                    : 'border-lichen text-archive hover:border-bark hover:text-bark',
                )}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-ink cursor-pointer pb-1">
          <Checkbox
            checked={showBio}
            onChange={(e) => onChange({ ...content, show_bio: e.target.checked })}
          />
          Show Biography
        </label>
      </div>
    </div>
  );
}

// =============================================================================
// Renderer
// =============================================================================

export function StaffGridRenderer({ content }: BlockRendererComponentProps) {
  const { orgSlug } = useParams<{ orgSlug: string }>();
  const constituentIds = (content.constituent_ids as string[]) || [];
  const departmentFilter = (content.department_filter as string) || '';
  const columns = (content.columns as number) ?? 3;
  const showBio = (content.show_bio as boolean) ?? false;

  const queryParams: Record<string, string | number> = {};
  if (constituentIds.length > 0) {
    queryParams.ids = constituentIds.join(',');
  } else if (departmentFilter) {
    queryParams.department = departmentFilter;
  }

  const { data, isLoading, error } = useQuery({
    queryKey: ['staff-grid-block', orgSlug, constituentIds, departmentFilter],
    queryFn: () => getPublicStaff(orgSlug!, queryParams),
    enabled: !!orgSlug,
    staleTime: 60_000,
  });

  if (!orgSlug) return null;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={24} className="animate-spin text-archive" />
      </div>
    );
  }

  if (error || !data || data.data.length === 0) {
    return (
      <div className="text-center py-8 text-archive text-sm">
        No staff members found.
      </div>
    );
  }

  const gridCols =
    columns === 2
      ? 'grid-cols-1 sm:grid-cols-2'
      : columns === 4
        ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4'
        : 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3';

  return (
    <div className={cn('grid gap-4', gridCols)}>
      {data.data.map((member) => (
        <div
          key={member.constituent_id}
          className="border border-lichen rounded-lg p-5 hover:border-bark/20 transition-colors"
        >
          {/* Avatar placeholder */}
          <div className="w-16 h-16 rounded-full bg-stone flex items-center justify-center mb-3">
            <User size={24} className="text-archive/40" />
          </div>

          <h4 className="text-sm font-medium text-ink">{member.name}</h4>
          {member.title && (
            <p className="text-xs text-archive mt-0.5">{member.title}</p>
          )}
          {member.role && (
            <p className="text-xs text-archive">{member.role}</p>
          )}
          {member.department && (
            <p className="text-xs text-bark mt-1">{member.department}</p>
          )}

          {showBio && member.biography && (
            <p className="text-xs text-ink/70 mt-2 line-clamp-3 leading-relaxed">
              {member.biography}
            </p>
          )}

          {member.email && (
            <a
              href={`mailto:${member.email}`}
              className="inline-flex items-center gap-1 text-xs text-bark hover:text-copper-dark transition-colors mt-2"
            >
              <Mail size={11} />
              {member.email}
            </a>
          )}
        </div>
      ))}
    </div>
  );
}
