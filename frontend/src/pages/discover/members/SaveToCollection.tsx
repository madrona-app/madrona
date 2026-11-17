/**
 * "Save to collection" on a public object page.
 *
 * Renders nothing while the portal does not offer saved collections. When
 * it does: a "Sign in to save" link for visitors, and for a signed-in member
 * a button that opens a labelled dialog with a radio group of their
 * collections plus "New collection".
 */
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bookmark } from 'lucide-react';
import { useAccessibleModal, getModalAriaProps } from '../../../hooks/useAccessibleModal';
import { ModalPortal } from '../../../components/ModalPortal';
import {
  addObjectToMemberCollection,
  createMemberCollection,
  listMemberCollections,
} from '../../../lib/api/discoverMembers';
import { ApiError } from '../../../lib/apiClient';
import { MEMBER_LINK_CLASS } from './MemberPageLayout';
import { memberCollectionsKey, useMemberSession } from './useMemberSession';

const NEW = '__new__';

interface SaveToCollectionProps {
  orgSlug: string;
  objectId: string;
  objectTitle: string;
}

interface SavedResult {
  collectionId: string;
  collectionName: string;
  alreadySaved: boolean;
}

export function SaveToCollection({ orgSlug, objectId, objectTitle }: SaveToCollectionProps) {
  const { enabled, member } = useMemberSession(orgSlug);
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<SavedResult | null>(null);

  if (!enabled) return null;

  if (!member) {
    return (
      <p className="mb-6 text-sm">
        <Link to={`/c/${orgSlug}/member/sign-in`} className={MEMBER_LINK_CLASS}>
          Sign in to save this object to a collection
        </Link>
      </p>
    );
  }

  return (
    <div className="mb-6">
      <button
        type="button"
        className="btn-secondary min-h-[44px] inline-flex items-center gap-1.5"
        onClick={() => {
          setResult(null);
          setOpen(true);
        }}
        aria-haspopup="dialog"
      >
        <Bookmark size={16} aria-hidden="true" />
        Save to collection
      </button>
      <p role="status" aria-live="polite" className="text-sm text-ink mt-2 min-h-[1.25rem]">
        {result && (
          <>
            {result.alreadySaved
              ? `${objectTitle} was already in ${result.collectionName}. `
              : `Saved ${objectTitle} to ${result.collectionName}. `}
            <Link to={`/c/${orgSlug}/member/collections/${result.collectionId}`} className={MEMBER_LINK_CLASS}>
              View {result.collectionName}
            </Link>
          </>
        )}
      </p>
      {open && (
        <SaveDialog
          orgSlug={orgSlug}
          objectId={objectId}
          objectTitle={objectTitle}
          onClose={() => setOpen(false)}
          onSaved={(r) => {
            setOpen(false);
            setResult(r);
          }}
        />
      )}
    </div>
  );
}

function SaveDialog({
  orgSlug,
  objectId,
  objectTitle,
  onClose,
  onSaved,
}: SaveToCollectionProps & { onClose: () => void; onSaved: (r: SavedResult) => void }) {
  const queryClient = useQueryClient();
  const { modalRef, titleId, descriptionId } = useAccessibleModal({
    isOpen: true,
    onClose,
    titlePrefix: 'save-to-collection',
  });
  const { data: collections, isLoading, error: loadError } = useQuery({
    queryKey: [...memberCollectionsKey(orgSlug), 'for-object', objectId],
    queryFn: () => listMemberCollections(orgSlug, objectId),
  });
  const [newName, setNewName] = useState('');
  const [nameError, setNameError] = useState('');
  const [failure, setFailure] = useState('');
  const [saving, setSaving] = useState(false);
  const newNameRef = useRef<HTMLInputElement>(null);

  // Until the member picks one: the first collection that does not hold the
  // object yet, else "New collection".
  const [picked, setChoice] = useState<string | null>(null);
  const choice =
    picked ?? (collections ? (collections.find((c) => !c.contains_object)?.collection_id ?? NEW) : null);

  // Once the options are there, put focus on the selected radio (the modal
  // hook focuses the first focusable element, which may not be the selected one).
  const focusedOnce = useRef(false);
  useEffect(() => {
    if (focusedOnce.current || choice === null || !modalRef.current) return;
    focusedOnce.current = true;
    const id = window.setTimeout(() => {
      const checked = modalRef.current?.querySelector<HTMLInputElement>('input[type="radio"]:checked');
      checked?.focus();
    }, 10);
    return () => window.clearTimeout(id);
  }, [choice, modalRef]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving || choice === null) return;
    setFailure('');
    let target: { id: string; name: string };
    setSaving(true);
    try {
      if (choice === NEW) {
        const name = newName.trim();
        if (!name) {
          setNameError('Give the new collection a name.');
          setSaving(false);
          newNameRef.current?.focus();
          return;
        }
        setNameError('');
        const created = await createMemberCollection(orgSlug, { name });
        target = { id: created.collection_id, name: created.name };
      } else {
        const existing = collections?.find((c) => c.collection_id === choice);
        if (!existing) {
          setSaving(false);
          return;
        }
        target = { id: existing.collection_id, name: existing.name };
      }
      const res = await addObjectToMemberCollection(orgSlug, target.id, objectId);
      await queryClient.invalidateQueries({ queryKey: memberCollectionsKey(orgSlug) });
      onSaved({ collectionId: target.id, collectionName: target.name, alreadySaved: res.already_saved });
    } catch (err) {
      setSaving(false);
      setFailure(
        err instanceof ApiError && err.status === 401
          ? 'Your session has ended. Sign in again to save.'
          : err instanceof ApiError && err.status < 500 && err.message
            ? err.message
            : 'The object could not be saved. Try again.',
      );
    }
  };

  return (
    <ModalPortal>
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-ink/50 p-4" onClick={onClose}>
        {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
        <div
          ref={modalRef}
          {...getModalAriaProps(titleId, descriptionId)}
          className="bg-parchment rounded-lg max-w-lg w-full shadow-xl max-h-[90vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <form onSubmit={handleSubmit} noValidate>
            <div className="px-6 py-5 border-b border-lichen">
              <h2 id={titleId} className="text-lg font-semibold text-ink font-serif">
                Save {objectTitle} to a collection
              </h2>
              <p id={descriptionId} className="text-sm text-archive mt-1">
                Choose one of your collections, or start a new one.
              </p>
            </div>
            <div className="px-6 py-5">
              {isLoading ? (
                <p className="text-sm text-archive">Loading your collections…</p>
              ) : loadError ? (
                <p role="alert" className="text-sm text-semantic-error">
                  Your collections could not be loaded. Close this dialog and try again.
                </p>
              ) : (
                <fieldset>
                  <legend className="text-sm font-medium text-ink mb-2">Collection</legend>
                  <div className="flex flex-col gap-1">
                    {(collections ?? []).map((c) => {
                      const id = `save-choice-${c.collection_id}`;
                      return (
                        <div key={c.collection_id} className="flex items-center gap-2 min-h-[44px]">
                          <input
                            type="radio"
                            id={id}
                            name="save-to-collection"
                            value={c.collection_id}
                            checked={choice === c.collection_id}
                            onChange={() => setChoice(c.collection_id)}
                            className="h-5 w-5 accent-bark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                          />
                          <label htmlFor={id} className="text-sm text-ink">
                            {c.name}{' '}
                            <span className="text-archive">
                              ({c.item_count === 1 ? '1 object' : `${c.item_count} objects`}
                              {c.contains_object ? ', already holds this object' : ''})
                            </span>
                          </label>
                        </div>
                      );
                    })}
                    <div className="flex items-center gap-2 min-h-[44px]">
                      <input
                        type="radio"
                        id="save-choice-new"
                        name="save-to-collection"
                        value={NEW}
                        checked={choice === NEW}
                        onChange={() => setChoice(NEW)}
                        className="h-5 w-5 accent-bark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                      />
                      <label htmlFor="save-choice-new" className="text-sm text-ink">
                        New collection
                      </label>
                    </div>
                  </div>
                  {choice === NEW && (
                    <div className="flex flex-col gap-1 mt-3 ml-7">
                      <label htmlFor="save-new-collection-name" className="text-sm font-medium text-ink">
                        Name for the new collection
                      </label>
                      <input
                        ref={newNameRef}
                        id="save-new-collection-name"
                        type="text"
                        maxLength={200}
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        aria-invalid={nameError ? true : undefined}
                        aria-describedby={nameError ? 'save-new-collection-name-error' : undefined}
                        className="min-h-[44px] px-3 py-2 rounded border border-archive bg-parchment-warm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                      />
                      {nameError && (
                        <p id="save-new-collection-name-error" className="text-sm text-semantic-error">
                          {nameError}
                        </p>
                      )}
                    </div>
                  )}
                </fieldset>
              )}
              {failure && (
                <p role="alert" className="text-sm text-semantic-error mt-3">
                  {failure}
                </p>
              )}
            </div>
            <div className="px-6 py-4 border-t border-lichen flex justify-end gap-3">
              <button type="button" onClick={onClose} className="btn-secondary min-h-[44px]">
                Cancel
              </button>
              <button type="submit" className="btn-primary min-h-[44px]" aria-disabled={saving || isLoading || undefined}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </ModalPortal>
  );
}
