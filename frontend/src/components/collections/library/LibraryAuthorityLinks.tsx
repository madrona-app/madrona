import { useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { getSubjectAuthorities } from '../../../lib/api/authorities';
import { getConstituents, type Constituent } from '../../../lib/api/constituents';
import type { SubjectAuthority } from '../../../lib/schemas';
import {
  addBibName,
  addBibSubject,
  NAME_ROLES,
  nameRoleLabel,
  removeBibName,
  removeBibSubject,
  type BibName,
  type BibSubject,
  type NameRole,
} from '../../../lib/api/library';
import { RecordSearch } from '../research-visits/RecordSearch';

const focusRing = 'focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2';
const fieldClass =
  'w-full px-3 py-2 border border-lichen rounded-lg bg-parchment text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark';

interface Props {
  orgId: string;
  recordId: string;
  subjects: BibSubject[];
  names: BibName[];
  canEdit: boolean;
}

/**
 * Subjects and names on a library record, linked to the subject authority
 * file and to person/organization records. Authorities are found with the
 * same plain search-and-pick control the research visit log uses (a search
 * field, a Search button and a list of results), not a combobox.
 */
export function LibraryAuthorityLinks({ orgId, recordId, subjects, names, canEdit }: Props) {
  const id = useId();
  const queryClient = useQueryClient();
  const subjectsHeadingRef = useRef<HTMLHeadingElement>(null);
  const namesHeadingRef = useRef<HTMLHeadingElement>(null);
  const subjectSearchRef = useRef<HTMLInputElement>(null);
  const nameSearchRef = useRef<HTMLInputElement>(null);
  const [announcement, setAnnouncement] = useState('');
  const [error, setError] = useState('');
  const [role, setRole] = useState<NameRole>('author');

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['library-record', orgId, recordId] });
  const linkedSubjects = new Set(subjects.map((s) => s.subject_authority_id));

  const addSubject = async (s: SubjectAuthority) => {
    setError('');
    try {
      await addBibSubject(orgId, recordId, s.authority_id);
      await refresh();
      setAnnouncement(`Added subject ${s.preferred_term}.`);
      subjectSearchRef.current?.focus();
    } catch (err) {
      setError(`Could not add subject ${s.preferred_term}: ${(err as Error).message}`);
      throw err;
    }
  };

  const removeSubject = async (s: BibSubject) => {
    setError('');
    try {
      await removeBibSubject(orgId, recordId, s.link_id);
      await refresh();
      setAnnouncement(`Removed subject ${s.preferred_term}.`);
      subjectsHeadingRef.current?.focus();
    } catch (err) {
      setError(`Could not remove subject ${s.preferred_term}: ${(err as Error).message}`);
    }
  };

  const addName = async (c: Constituent) => {
    setError('');
    const label = c.display_name || c.name;
    try {
      await addBibName(orgId, recordId, c.constituent_id, role);
      await refresh();
      setAnnouncement(`Added ${label} as ${nameRoleLabel(role).toLowerCase()}.`);
      nameSearchRef.current?.focus();
    } catch (err) {
      setError(`Could not add ${label}: ${(err as Error).message}`);
      throw err;
    }
  };

  const removeName = async (n: BibName) => {
    setError('');
    try {
      await removeBibName(orgId, recordId, n.link_id);
      await refresh();
      setAnnouncement(`Removed ${n.name}, ${nameRoleLabel(n.role).toLowerCase()}.`);
      namesHeadingRef.current?.focus();
    } catch (err) {
      setError(`Could not remove ${n.name}: ${(err as Error).message}`);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <p role="status" aria-live="polite" className="sr-only">{announcement}</p>
      {error && (
        <p role="alert" className="lg:col-span-2 p-3 rounded-lg bg-semantic-error/10 border border-semantic-error/30 text-sm text-semantic-error">
          {error}
        </p>
      )}

      <section aria-labelledby={`${id}-names`} className="bg-parchment border border-lichen rounded-lg p-6">
        <h2 id={`${id}-names`} ref={namesHeadingRef} tabIndex={-1} className="text-lg font-semibold text-forest mb-3 focus:outline-none">
          Names
        </h2>
        {names.length === 0 ? (
          <p className="text-sm text-archive mb-4">No names linked yet.</p>
        ) : (
          <ul aria-label="Names on this record" className="mb-4 divide-y divide-lichen border border-lichen rounded-lg">
            {names.map((n) => (
              <li key={n.link_id} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="text-sm text-ink">
                  <Link to={`/organizations/${orgId}/collections/constituents/${n.constituent_id}`} className={`text-bark hover:text-copper-dark rounded ${focusRing}`}>
                    {n.name || 'Unnamed record'}
                  </Link>
                  <span className="text-archive">, {nameRoleLabel(n.role).toLowerCase()}</span>
                </span>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => void removeName(n)}
                    aria-label={`Remove ${n.name}, ${nameRoleLabel(n.role).toLowerCase()}`}
                    className={`btn btn-tertiary min-h-[44px] text-semantic-error shrink-0 ${focusRing}`}
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {canEdit && (
          <div className="border-t border-lichen pt-4 space-y-3">
            <h3 className="text-base font-medium text-forest">Add a name</h3>
            <div>
              <label htmlFor={`${id}-role`} className="block text-sm font-medium text-ink mb-1">Role</label>
              <select id={`${id}-role`} value={role} onChange={(e) => setRole(e.target.value as NameRole)} className={fieldClass}>
                {NAME_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            <RecordSearch<Constituent>
              label="Find a person or organization record"
              noun="person or organization record"
              inputRef={nameSearchRef}
              search={async (term) => (await getConstituents(orgId, { q: term, limit: 10 })).items}
              getId={(c) => c.constituent_id}
              renderItem={(c) => (
                <>
                  <span className="font-medium">{c.display_name || c.name}</span>
                  {c.organization_name && <span className="text-archive"> — {c.organization_name}</span>}
                </>
              )}
              pickText="Add"
              pickLabel={(c) => `Add ${c.display_name || c.name} as ${nameRoleLabel(role).toLowerCase()}`}
              onPick={addName}
            />
          </div>
        )}
      </section>

      <section aria-labelledby={`${id}-subjects`} className="bg-parchment border border-lichen rounded-lg p-6">
        <h2 id={`${id}-subjects`} ref={subjectsHeadingRef} tabIndex={-1} className="text-lg font-semibold text-forest mb-3 focus:outline-none">
          Subjects
        </h2>
        {subjects.length === 0 ? (
          <p className="text-sm text-archive mb-4">No subjects linked yet.</p>
        ) : (
          <ul aria-label="Subjects on this record" className="mb-4 divide-y divide-lichen border border-lichen rounded-lg">
            {subjects.map((s) => (
              <li key={s.link_id} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="text-sm text-ink">
                  {s.preferred_term}
                  {s.lcsh_id && <span className="text-archive"> (LCSH {s.lcsh_id})</span>}
                </span>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => void removeSubject(s)}
                    aria-label={`Remove subject ${s.preferred_term}`}
                    className={`btn btn-tertiary min-h-[44px] text-semantic-error shrink-0 ${focusRing}`}
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {canEdit && (
          <div className="border-t border-lichen pt-4">
            <h3 className="text-base font-medium text-forest mb-3">Add a subject</h3>
            <RecordSearch<SubjectAuthority>
              label="Find a subject heading"
              noun="subject"
              inputRef={subjectSearchRef}
              search={async (term) => (await getSubjectAuthorities(orgId, { search: term, limit: 10 })).items}
              getId={(s) => s.authority_id}
              excludeIds={linkedSubjects}
              renderItem={(s) => (
                <>
                  <span className="font-medium">{s.preferred_term}</span>
                  {s.lcsh_id && <span className="text-archive"> (LCSH {s.lcsh_id})</span>}
                </>
              )}
              pickText="Add"
              pickLabel={(s) => `Add subject ${s.preferred_term}`}
              onPick={addSubject}
            />
          </div>
        )}
      </section>
    </div>
  );
}
