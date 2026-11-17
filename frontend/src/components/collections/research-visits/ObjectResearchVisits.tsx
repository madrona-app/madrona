import { useId } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getObjectResearchVisits } from '../../../lib/api/researchVisits';
import { formatDateShort } from '@/lib/formatters';
import { usePermissions } from '../../../hooks/usePermissions';

const focusRing = 'focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2';

/**
 * Read-only list of the research visits during which an object was used,
 * shown on the object record. Hidden for users who cannot view visits.
 */
export function ObjectResearchVisits({ organizationId, objectId }: { organizationId: string; objectId: string }) {
  const uid = useId();
  const { hasPermission } = usePermissions();
  const allowed = hasPermission('use_requests.view');

  const { data, isLoading, error } = useQuery({
    queryKey: ['object-research-visits', organizationId, objectId],
    queryFn: () => getObjectResearchVisits(organizationId, objectId),
    enabled: allowed && !!objectId,
  });

  if (!allowed) return null;

  const items = data?.items ?? [];

  return (
    <section aria-labelledby={`${uid}-heading`} className="border-t border-lichen pt-4 mt-4 px-4">
      <h3 id={`${uid}-heading`} className="text-sm font-medium text-forest mb-2">
        Research visits
      </h3>
      {isLoading ? (
        <p className="text-sm text-archive">Loading research visits…</p>
      ) : error ? (
        <p role="alert" className="text-sm text-semantic-error">Could not load research visits.</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-archive">This object has not been used in a logged research visit.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Research visits that used this object, newest first
            </caption>
            <thead className="bg-stone/50">
              <tr>
                <th scope="col" className="px-3 py-2 text-left font-medium text-ink">Date</th>
                <th scope="col" className="px-3 py-2 text-left font-medium text-ink">Researcher</th>
                <th scope="col" className="px-3 py-2 text-left font-medium text-ink">Research topic</th>
                <th scope="col" className="px-3 py-2 text-left font-medium text-ink">Handling note</th>
                <th scope="col" className="px-3 py-2 text-left font-medium text-ink">Condition on return</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-lichen">
              {items.map((v) => (
                <tr key={v.visit_id} className="align-top">
                  <td className="px-3 py-2 text-ink whitespace-nowrap">{formatDateShort(v.visit_date)}</td>
                  <th scope="row" className="px-3 py-2 text-left font-normal">
                    <Link
                      to={`/organizations/${organizationId}/collections/research-visits/${v.visit_id}`}
                      className={`text-bark hover:text-copper-dark rounded ${focusRing}`}
                    >
                      {v.researcher_name}
                    </Link>
                    {v.researcher_affiliation && <div className="text-archive">{v.researcher_affiliation}</div>}
                  </th>
                  <td className="px-3 py-2 text-ink">{v.research_topic || <span className="text-archive">Not recorded</span>}</td>
                  <td className="px-3 py-2 text-ink">{v.handling_note || <span className="text-archive">None recorded</span>}</td>
                  <td className="px-3 py-2 text-ink">{v.condition_on_return || <span className="text-archive">None recorded</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
