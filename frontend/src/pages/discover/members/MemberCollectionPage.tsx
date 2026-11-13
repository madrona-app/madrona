/**
 * One of a member's saved collections: its objects, a Remove button per
 * object (named for the object), and CSV/JSON export through the same
 * download controls as the public portal.
 */
import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import {
  getMemberCollection,
  getMemberCollectionExportUrl,
  removeObjectFromMemberCollection,
} from '../../../lib/api/discoverMembers';
import type { MemberCollectionItem } from '../../../lib/api/discoverMembers';
import { ApiError } from '../../../lib/apiClient';
import { ResultsActions } from '../components/ResultsActions';
import { MemberPageLayout, MEMBER_LINK_CLASS } from './MemberPageLayout';
import { SignedOut } from './MyCollectionsPage';
import { itemCountText, objectTitle } from './memberText';
import { memberCollectionsKey } from './useMemberSession';

const REMOVE_BUTTON =
  'inline-flex items-center gap-1.5 min-h-[44px] px-3 py-2 rounded border border-lichen bg-parchment text-sm text-ink hover:bg-stone transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2';

export default function MemberCollectionPage() {
  const { orgSlug = '', collectionId = '' } = useParams<{ orgSlug: string; collectionId: string }>();
  return (
    <MemberPageLayout orgSlug={orgSlug} title="Saved collection">
      {({ member }) =>
        member ? <CollectionDetail orgSlug={orgSlug} collectionId={collectionId} /> : <SignedOut orgSlug={orgSlug} />
      }
    </MemberPageLayout>
  );
}

function CollectionDetail({ orgSlug, collectionId }: { orgSlug: string; collectionId: string }) {
  const queryClient = useQueryClient();
  const queryKey = ['discover-member-collection', orgSlug, collectionId];
  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: () => getMemberCollection(orgSlug, collectionId),
    retry: false,
  });
  const [status, setStatus] = useState('');
  const headingRef = useRef<HTMLHeadingElement>(null);
  const removeButtons = useRef<Record<string, HTMLButtonElement | null>>({});

  const announce = (message: string) => {
    setStatus('');
    window.setTimeout(() => setStatus(message), 50);
  };

  if (isLoading) return <p className="text-archive">Loading the collection…</p>;
  if (error || !data) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <>
        <h1 className="font-serif text-3xl font-light text-ink mb-4">
          {notFound ? 'Collection not found' : 'The collection could not be loaded'}
        </h1>
        <Link to={`/c/${orgSlug}/member/collections`} className={MEMBER_LINK_CLASS}>
          Back to my collections
        </Link>
      </>
    );
  }

  const handleRemove = async (item: MemberCollectionItem, index: number) => {
    const title = objectTitle(item);
    try {
      await removeObjectFromMemberCollection(orgSlug, collectionId, item.object_id);
    } catch {
      announce(`${title} could not be removed. Try again.`);
      return;
    }
    const remaining = data.items.filter((i) => i.object_id !== item.object_id);
    // Focus the next object's Remove button, else the previous one, else the heading.
    const next = remaining[index] ?? remaining[index - 1];
    queryClient.setQueryData(queryKey, { ...data, items: remaining, item_count: remaining.length });
    queryClient.invalidateQueries({ queryKey: memberCollectionsKey(orgSlug) });
    announce(`Removed ${title} from ${data.name}.`);
    window.setTimeout(() => {
      const target = next ? removeButtons.current[next.object_id] : null;
      (target ?? headingRef.current)?.focus();
    }, 0);
  };

  return (
    <>
      <p className="mb-4">
        <Link to={`/c/${orgSlug}/member/collections`} className={MEMBER_LINK_CLASS}>
          My collections
        </Link>
      </p>
      <h1 ref={headingRef} tabIndex={-1} className="font-serif text-3xl font-light text-ink mb-1 focus:outline-none">
        {data.name}
      </h1>
      <p className="text-sm text-archive mb-2">{itemCountText(data.items.length)}</p>
      {data.description && <p className="text-ink mb-4 max-w-prose">{data.description}</p>}

      <div className="my-6">
        <ResultsActions
          total={data.items.length}
          noun={['object', 'objects']}
          csvUrl={getMemberCollectionExportUrl(orgSlug, collectionId, 'csv')}
          jsonUrl={getMemberCollectionExportUrl(orgSlug, collectionId, 'json')}
          idPrefix="member-collection"
        />
      </div>

      <p role="status" aria-live="polite" className="text-sm text-ink min-h-[1.25rem] mb-2">
        {status}
      </p>

      <h2 className="text-lg font-medium text-ink mb-3">Objects in this collection</h2>
      {data.items.length === 0 ? (
        <p className="text-ink">
          No objects yet. Open any object in the collection and choose Save to collection.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {data.items.map((item, index) => {
            const title = objectTitle(item);
            const ref = item.object.object_number || item.object_id;
            return (
              <li key={item.object_id} className="p-4 rounded border border-lichen bg-parchment flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-base font-medium">
                    <Link to={`/c/${orgSlug}/objects/${encodeURIComponent(ref)}`} className={MEMBER_LINK_CLASS}>
                      {title}
                    </Link>
                  </h3>
                  {item.object.object_number && (
                    <p className="text-xs text-archive">{item.object.object_number}</p>
                  )}
                  {(item.object.creators.length > 0 || item.object.creation_date_display) && (
                    <p className="text-sm text-ink">
                      {[item.object.creators.join(', '), item.object.creation_date_display].filter(Boolean).join(', ')}
                    </p>
                  )}
                  {item.note && <p className="text-sm text-ink mt-1">Note: {item.note}</p>}
                </div>
                <button
                  type="button"
                  ref={(el) => {
                    removeButtons.current[item.object_id] = el;
                  }}
                  className={REMOVE_BUTTON}
                  onClick={() => handleRemove(item, index)}
                  aria-label={`Remove ${title} from this collection`}
                >
                  <Trash2 size={16} aria-hidden="true" />
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
