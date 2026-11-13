import { useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { getCollectionObjects } from '../../../lib/api';
import type { CollectionObjectListItem } from '../../../lib/schemas';
import {
  addResearchVisitObject,
  removeResearchVisitObject,
  updateResearchVisitObject,
  type ResearchVisitObject,
} from '../../../lib/api/researchVisits';
import { RecordSearch } from './RecordSearch';

const fieldClass =
  'w-full px-3 py-2 border border-lichen rounded-lg bg-parchment text-ink text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark';
const focusRing = 'focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2';

function objectLabel(o: { object_number: string | null; object_name?: string | null; title?: string | null }) {
  const name = o.title || o.object_name;
  return name ? `${o.object_number}, ${name}` : `${o.object_number}`;
}

interface Props {
  orgId: string;
  visitId: string;
  objects: ResearchVisitObject[];
  canEdit: boolean;
}

/** The objects used during a visit: a table, plus add / annotate / remove. */
export function ResearchVisitObjects({ orgId, visitId, objects, canEdit }: Props) {
  const id = useId();
  const queryClient = useQueryClient();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [announcement, setAnnouncement] = useState('');
  const [error, setError] = useState('');
  const [handlingNote, setHandlingNote] = useState('');
  const [conditionNote, setConditionNote] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ handling_note: '', condition_on_return: '' });
  const editButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const firstEditFieldRef = useRef<HTMLTextAreaElement>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['research-visit', orgId, visitId] });
  const linkedIds = new Set(objects.map((o) => o.object_id));

  const handleAdd = async (obj: CollectionObjectListItem) => {
    setError('');
    try {
      await addResearchVisitObject(orgId, visitId, {
        object_id: obj.object_id,
        handling_note: handlingNote || null,
        condition_on_return: conditionNote || null,
      });
      await refresh();
      setHandlingNote('');
      setConditionNote('');
      setAnnouncement(`Added ${objectLabel(obj)} to this visit.`);
      searchRef.current?.focus();
    } catch (err) {
      setError(`Could not add ${obj.object_number}: ${(err as Error).message}`);
      throw err;
    }
  };

  const handleRemove = async (link: ResearchVisitObject) => {
    setError('');
    try {
      await removeResearchVisitObject(orgId, visitId, link.object_id);
      await refresh();
      setAnnouncement(`Removed ${objectLabel(link)} from this visit.`);
      headingRef.current?.focus();
    } catch (err) {
      setError(`Could not remove ${link.object_number}: ${(err as Error).message}`);
    }
  };

  const startEdit = (link: ResearchVisitObject) => {
    setEditingId(link.object_id);
    setDraft({ handling_note: link.handling_note ?? '', condition_on_return: link.condition_on_return ?? '' });
    requestAnimationFrame(() => firstEditFieldRef.current?.focus());
  };

  const stopEdit = (objectId: string) => {
    setEditingId(null);
    requestAnimationFrame(() => editButtonRefs.current[objectId]?.focus());
  };

  const saveEdit = async (link: ResearchVisitObject) => {
    setError('');
    try {
      await updateResearchVisitObject(orgId, visitId, link.object_id, {
        handling_note: draft.handling_note || null,
        condition_on_return: draft.condition_on_return || null,
      });
      await refresh();
      setAnnouncement(`Saved notes for ${link.object_number}.`);
      stopEdit(link.object_id);
    } catch (err) {
      setError(`Could not save notes for ${link.object_number}: ${(err as Error).message}`);
    }
  };

  return (
    <section aria-labelledby={`${id}-heading`} className="bg-parchment border border-lichen rounded-lg p-6">
      <h2 id={`${id}-heading`} ref={headingRef} tabIndex={-1} className="text-lg font-semibold text-forest mb-3 focus:outline-none">
        Objects used
      </h2>

      <p role="status" aria-live="polite" className="sr-only">{announcement}</p>
      {error && (
        <p role="alert" className="mb-3 p-3 rounded-lg bg-semantic-error/10 border border-semantic-error/30 text-sm text-semantic-error">
          {error}
        </p>
      )}

      {objects.length === 0 ? (
        <p className="text-sm text-archive mb-4">No objects recorded for this visit yet.</p>
      ) : (
        <div className="overflow-x-auto mb-6">
          <table className="w-full text-sm">
            <caption className="text-left text-sm text-archive pb-2">
              {objects.length === 1 ? '1 object' : `${objects.length} objects`} used during this visit
            </caption>
            <thead className="bg-stone/50">
              <tr>
                <th scope="col" className="px-3 py-2 text-left font-medium text-ink">Object number</th>
                <th scope="col" className="px-3 py-2 text-left font-medium text-ink">Name</th>
                <th scope="col" className="px-3 py-2 text-left font-medium text-ink">Handling note</th>
                <th scope="col" className="px-3 py-2 text-left font-medium text-ink">Condition on return</th>
                {canEdit && <th scope="col" className="px-3 py-2 text-left font-medium text-ink">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-lichen">
              {objects.map((link) => {
                const editing = editingId === link.object_id;
                const handlingId = `${id}-handling-${link.object_id}`;
                const conditionId = `${id}-condition-${link.object_id}`;
                return (
                  <tr key={link.visit_object_id} className="align-top">
                    <th scope="row" className="px-3 py-2 text-left font-medium">
                      <Link
                        to={`/organizations/${orgId}/collections/objects/${link.object_id}`}
                        className={`text-bark hover:text-copper-dark rounded ${focusRing}`}
                      >
                        {link.object_number}
                      </Link>
                    </th>
                    <td className="px-3 py-2 text-ink">{link.object_name || 'Untitled'}</td>
                    {editing ? (
                      <>
                        <td className="px-3 py-2">
                          <label htmlFor={handlingId} className="sr-only">Handling note for {link.object_number}</label>
                          <textarea
                            id={handlingId}
                            ref={firstEditFieldRef}
                            rows={2}
                            value={draft.handling_note}
                            onChange={(e) => setDraft((d) => ({ ...d, handling_note: e.target.value }))}
                            className={fieldClass}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <label htmlFor={conditionId} className="sr-only">Condition on return for {link.object_number}</label>
                          <textarea
                            id={conditionId}
                            rows={2}
                            value={draft.condition_on_return}
                            onChange={(e) => setDraft((d) => ({ ...d, condition_on_return: e.target.value }))}
                            className={fieldClass}
                          />
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-3 py-2 text-ink whitespace-pre-line">{link.handling_note || <span className="text-archive">None recorded</span>}</td>
                        <td className="px-3 py-2 text-ink whitespace-pre-line">{link.condition_on_return || <span className="text-archive">None recorded</span>}</td>
                      </>
                    )}
                    {canEdit && (
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-2">
                          {editing ? (
                            <>
                              <button type="button" onClick={() => void saveEdit(link)} aria-label={`Save notes for ${link.object_number}`} className={`btn btn-primary min-h-[44px] ${focusRing}`}>
                                Save
                              </button>
                              <button type="button" onClick={() => stopEdit(link.object_id)} aria-label={`Cancel editing notes for ${link.object_number}`} className={`btn btn-tertiary min-h-[44px] ${focusRing}`}>
                                Cancel
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                ref={(el) => { editButtonRefs.current[link.object_id] = el; }}
                                onClick={() => startEdit(link)}
                                aria-label={`Edit notes for ${link.object_number}`}
                                className={`btn btn-tertiary min-h-[44px] ${focusRing}`}
                              >
                                Edit notes
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleRemove(link)}
                                aria-label={`Remove ${objectLabel(link)} from this visit`}
                                className={`btn btn-tertiary min-h-[44px] text-semantic-error ${focusRing}`}
                              >
                                Remove
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {canEdit && (
        <div className="border-t border-lichen pt-4">
          <h3 className="text-base font-medium text-forest mb-1">Add an object</h3>
          <p className="text-sm text-archive mb-3">
            Notes entered here are saved with the next object you add. You can change them later.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 mb-3">
            <div>
              <label htmlFor={`${id}-new-handling`} className="block text-sm font-medium text-ink mb-1">
                Handling note (optional)
              </label>
              <textarea
                id={`${id}-new-handling`}
                rows={2}
                value={handlingNote}
                onChange={(e) => setHandlingNote(e.target.value)}
                className={fieldClass}
              />
            </div>
            <div>
              <label htmlFor={`${id}-new-condition`} className="block text-sm font-medium text-ink mb-1">
                Condition on return (optional)
              </label>
              <textarea
                id={`${id}-new-condition`}
                rows={2}
                value={conditionNote}
                onChange={(e) => setConditionNote(e.target.value)}
                className={fieldClass}
              />
            </div>
          </div>
          <RecordSearch<CollectionObjectListItem>
            label="Find an object by number or name"
            noun="object"
            inputRef={searchRef}
            search={async (term) => (await getCollectionObjects(orgId, { search: term, limit: 20 })).items || []}
            getId={(o) => o.object_id}
            excludeIds={linkedIds}
            renderItem={(o) => (
              <>
                <span className="font-medium">{o.object_number}</span>
                <span className="text-archive"> — {o.title || o.object_name || 'Untitled'}</span>
              </>
            )}
            pickText="Add"
            pickLabel={(o) => `Add ${objectLabel(o)} to this visit`}
            onPick={handleAdd}
          />
        </div>
      )}
    </section>
  );
}
