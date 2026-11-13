/**
 * "My collections": a signed-in member's saved collections.
 *
 * List, create, rename (inline form), delete (ConfirmDialog), sign out.
 * Every result is announced in one polite live region, and focus is moved
 * deliberately: into the rename field when it opens, back to the Rename
 * button when it closes, and to the list heading after a delete.
 */
import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderPlus, LogOut, Pencil, Trash2 } from 'lucide-react';
import ConfirmDialog from '../../../components/ConfirmDialog';
import {
  createMemberCollection,
  deleteMemberCollection,
  listMemberCollections,
  memberSignOut,
  updateMemberCollection,
} from '../../../lib/api/discoverMembers';
import type { MemberCollectionSummary } from '../../../lib/api/discoverMembers';
import { ApiError } from '../../../lib/apiClient';
import { MemberPageLayout, MEMBER_LINK_CLASS } from './MemberPageLayout';
import { memberCollectionsKey, memberSessionKey } from './useMemberSession';
import { itemCountText } from './memberText';

const INPUT_CLASS =
  'min-h-[44px] px-3 py-2 rounded border border-archive bg-parchment-warm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2';
const SMALL_BUTTON =
  'inline-flex items-center gap-1.5 min-h-[44px] px-3 py-2 rounded border border-lichen bg-parchment text-sm text-ink hover:bg-stone transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2';

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.status === 401) return 'Your session has ended. Sign in again.';
  if (err instanceof ApiError && err.message && err.status < 500) return err.message;
  return fallback;
}

export default function MyCollectionsPage() {
  const { orgSlug = '' } = useParams<{ orgSlug: string }>();
  return (
    <MemberPageLayout orgSlug={orgSlug} title="My collections">
      {({ member }) =>
        member ? (
          <CollectionsManager orgSlug={orgSlug} memberName={member.display_name || member.email} />
        ) : (
          <SignedOut orgSlug={orgSlug} />
        )
      }
    </MemberPageLayout>
  );
}

export function SignedOut({ orgSlug }: { orgSlug: string }) {
  return (
    <>
      <h1 className="font-serif text-3xl font-light text-ink mb-4">My collections</h1>
      <p className="text-ink mb-4">Sign in to see and manage your saved collections.</p>
      <Link to={`/c/${orgSlug}/member/sign-in`} className={MEMBER_LINK_CLASS}>
        Sign in
      </Link>
    </>
  );
}

function CollectionsManager({ orgSlug, memberName }: { orgSlug: string; memberName: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [status, setStatus] = useState('');
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [createError, setCreateError] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<MemberCollectionSummary | null>(null);
  const listHeadingRef = useRef<HTMLHeadingElement>(null);
  const newNameRef = useRef<HTMLInputElement>(null);
  const renameButtons = useRef<Record<string, HTMLButtonElement | null>>({});

  const announce = (message: string) => {
    // Clear first so a repeated message is announced again.
    setStatus('');
    window.setTimeout(() => setStatus(message), 50);
  };

  const { data: collections = [], isLoading, error } = useQuery({
    queryKey: memberCollectionsKey(orgSlug),
    queryFn: () => listMemberCollections(orgSlug),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: memberCollectionsKey(orgSlug) });

  const createMutation = useMutation({
    mutationFn: () => createMemberCollection(orgSlug, { name: newName.trim(), description: newDescription.trim() || null }),
    onSuccess: async (created) => {
      setNewName('');
      setNewDescription('');
      await refresh();
      announce(`Created collection ${created.name}.`);
    },
    onError: (err) => {
      setCreateError(errorMessage(err, 'The collection could not be created. Try again.'));
      newNameRef.current?.focus();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (c: MemberCollectionSummary) => deleteMemberCollection(orgSlug, c.collection_id),
    onSuccess: async (_, c) => {
      await refresh();
      announce(`Deleted collection ${c.name}.`);
      listHeadingRef.current?.focus();
    },
    onError: (err) => announce(errorMessage(err, 'The collection could not be deleted. Try again.')),
  });

  const signOutMutation = useMutation({
    mutationFn: () => memberSignOut(orgSlug),
    onSettled: () => {
      queryClient.setQueryData(memberSessionKey(orgSlug), { enabled: true, member: null });
      queryClient.removeQueries({ queryKey: memberCollectionsKey(orgSlug) });
      navigate(`/c/${orgSlug}/member/sign-in`);
    },
  });

  const handleCreate = (e: FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) {
      setCreateError('Give the collection a name.');
      newNameRef.current?.focus();
      return;
    }
    setCreateError('');
    createMutation.mutate();
  };

  const closeRename = (collectionId: string) => {
    setRenamingId(null);
    window.setTimeout(() => renameButtons.current[collectionId]?.focus(), 0);
  };

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="font-serif text-3xl font-light text-ink mb-1">My collections</h1>
          <p className="text-sm text-archive">Signed in as {memberName}</p>
        </div>
        <button type="button" className={SMALL_BUTTON} onClick={() => signOutMutation.mutate()}>
          <LogOut size={16} aria-hidden="true" />
          Sign out
        </button>
      </div>

      <p role="status" aria-live="polite" className="text-sm text-ink min-h-[1.25rem] mb-4">
        {status}
      </p>

      <section aria-labelledby="new-collection-heading" className="mb-10 p-4 rounded border border-lichen bg-parchment-warm">
        <h2 id="new-collection-heading" className="text-lg font-medium text-ink mb-3">
          New collection
        </h2>
        <form onSubmit={handleCreate} noValidate className="flex flex-col gap-3 max-w-lg">
          <div className="flex flex-col gap-1">
            <label htmlFor="new-collection-name" className="text-sm font-medium text-ink">
              Collection name
            </label>
            <input
              ref={newNameRef}
              id="new-collection-name"
              type="text"
              maxLength={200}
              required
              aria-required="true"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              aria-invalid={createError ? true : undefined}
              aria-describedby={createError ? 'new-collection-name-error' : undefined}
              className={INPUT_CLASS}
            />
            {createError && (
              <p id="new-collection-name-error" className="text-sm text-semantic-error">
                {createError}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="new-collection-description" className="text-sm font-medium text-ink">
              Description (optional)
            </label>
            <textarea
              id="new-collection-description"
              rows={2}
              maxLength={2000}
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <button type="submit" className="btn-primary min-h-[44px] inline-flex items-center gap-1.5">
              <FolderPlus size={16} aria-hidden="true" />
              Create collection
            </button>
          </div>
        </form>
      </section>

      <h2 ref={listHeadingRef} tabIndex={-1} className="text-lg font-medium text-ink mb-3 focus:outline-none">
        Your collections{!isLoading && !error ? ` (${collections.length})` : ''}
      </h2>
      {isLoading ? (
        <p className="text-archive">Loading your collections…</p>
      ) : error ? (
        <p role="alert" className="text-semantic-error">
          {errorMessage(error, 'Your collections could not be loaded. Reload the page to try again.')}
        </p>
      ) : collections.length === 0 ? (
        <p className="text-ink">
          You have no collections yet. Create one above, or use Save to collection on any object page.
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {collections.map((c) => (
            <li key={c.collection_id} className="p-4 rounded border border-lichen bg-parchment">
              {renamingId === c.collection_id ? (
                <RenameForm
                  orgSlug={orgSlug}
                  collection={c}
                  onDone={async (newNameValue) => {
                    if (newNameValue) {
                      await refresh();
                      announce(`Renamed ${c.name} to ${newNameValue}.`);
                    }
                    closeRename(c.collection_id);
                  }}
                />
              ) : (
                <>
                  <h3 className="text-base font-medium mb-1">
                    <Link to={`/c/${orgSlug}/member/collections/${c.collection_id}`} className={MEMBER_LINK_CLASS}>
                      {c.name}
                    </Link>
                  </h3>
                  <p className="text-sm text-archive mb-1">{itemCountText(c.item_count)}</p>
                  {c.description && <p className="text-sm text-ink mb-2">{c.description}</p>}
                  <div className="flex flex-wrap gap-2 mt-2">
                    <button
                      type="button"
                      ref={(el) => {
                        renameButtons.current[c.collection_id] = el;
                      }}
                      className={SMALL_BUTTON}
                      onClick={() => setRenamingId(c.collection_id)}
                      aria-label={`Rename ${c.name}`}
                    >
                      <Pencil size={16} aria-hidden="true" />
                      Rename
                    </button>
                    <button
                      type="button"
                      className={SMALL_BUTTON}
                      onClick={() => setPendingDelete(c)}
                      aria-label={`Delete ${c.name}`}
                    >
                      <Trash2 size={16} aria-hidden="true" />
                      Delete
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="mt-10">
        <Link to={`/c/${orgSlug}`} className={MEMBER_LINK_CLASS}>
          Search the collection
        </Link>
      </p>

      <ConfirmDialog
        isOpen={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) deleteMutation.mutate(pendingDelete);
        }}
        title={pendingDelete ? `Delete ${pendingDelete.name}?` : 'Delete collection?'}
        message={
          pendingDelete
            ? `The collection and its list of ${itemCountText(pendingDelete.item_count)} will be deleted. The objects themselves stay in the public collection. This cannot be undone.`
            : ''
        }
        confirmText="Delete collection"
        confirmStyle="danger"
      />
    </>
  );
}

function RenameForm({
  orgSlug,
  collection,
  onDone,
}: {
  orgSlug: string;
  collection: MemberCollectionSummary;
  onDone: (newName: string | null) => void;
}) {
  const [value, setValue] = useState(collection.name);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const inputId = `rename-${collection.collection_id}`;
  const errorId = `${inputId}-error`;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const name = value.trim();
    if (!name) {
      setError('Give the collection a name.');
      return;
    }
    if (name === collection.name) {
      onDone(null);
      return;
    }
    setSaving(true);
    try {
      await updateMemberCollection(orgSlug, collection.collection_id, { name });
      onDone(name);
    } catch (err) {
      setError(errorMessage(err, 'The collection could not be renamed. Try again.'));
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-2">
      <label htmlFor={inputId} className="text-sm font-medium text-ink">
        New name for {collection.name}
      </label>
      <input
        id={inputId}
        type="text"
        maxLength={200}
        // Focus moves here when the form opens: the user just asked to rename.
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={INPUT_CLASS}
      />
      {error && (
        <p id={errorId} className="text-sm text-semantic-error">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" className="btn-primary min-h-[44px]">
          Save name
        </button>
        <button type="button" className={SMALL_BUTTON} onClick={() => onDone(null)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
