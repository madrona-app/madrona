import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  User,
  UserPlus,
  Loader2,
  CheckCircle,
  ArrowLeft,
} from 'lucide-react';
import {
  getAuthorities,
  createAuthority,
  linkObjectAuthority,
} from '../../../lib/api';
import type { PersonAuthority } from '../../../lib/schemas';
import type { AddAuthoritySlideOverProps } from './types';
import { LIFE_ROLE_OPTIONS } from './constants';
import { LinkDetailsForm } from './LinkDetailsForm';
import SlideOver from '../../ui/SlideOver';

export function AddAuthoritySlideOver({
  isOpen,
  organizationId,
  objectId,
  onClose,
  onSuccess,
}: AddAuthoritySlideOverProps) {
  const queryClient = useQueryClient();

  // Mode: 'search' or 'create'
  const [mode, setMode] = useState<'search' | 'create'>('search');

  // Search/Select state
  const [selectedAuthorityId, setSelectedAuthorityId] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');

  // Link details state
  const [role, setRole] = useState<string>('creator');
  const [roleQualifier, setRoleQualifier] = useState<string>('');
  const [certainty, setCertainty] = useState<string>('');
  const [displayNameOverride, setDisplayNameOverride] = useState<string>('');
  const [notes, setNotes] = useState<string>('');

  // Create new authority state
  const [newAuthorityName, setNewAuthorityName] = useState('');
  const [newAuthorityNationality, setNewAuthorityNationality] = useState('');
  const [newAuthorityLifeRole, setNewAuthorityLifeRole] = useState('');
  const [newAuthorityBirthDate, setNewAuthorityBirthDate] = useState('');
  const [newAuthorityDeathDate, setNewAuthorityDeathDate] = useState('');

  const [error, setError] = useState<string | null>(null);

  // Reset state when panel opens/closes
  React.useEffect(() => {
    if (isOpen) {
      setMode('search');
      setSelectedAuthorityId('');
      setSearchQuery('');
      setRole('creator');
      setRoleQualifier('');
      setCertainty('');
      setDisplayNameOverride('');
      setNotes('');
      setNewAuthorityName('');
      setNewAuthorityNationality('');
      setNewAuthorityLifeRole('');
      setNewAuthorityBirthDate('');
      setNewAuthorityDeathDate('');
      setError(null);
    }
  }, [isOpen]);

  const { data: authoritiesData, isLoading: loadingAuthorities } = useQuery({
    queryKey: ['authorities-search', organizationId, searchQuery],
    queryFn: () => getAuthorities(organizationId, { search: searchQuery || undefined, status: 'active', limit: 50 }),
    enabled: searchQuery.length > 1 && mode === 'search',
  });

  // Create authority mutation
  const createAuthorityMutation = useMutation({
    mutationFn: () => createAuthority(organizationId, {
      preferred_name: newAuthorityName.trim(),
      nationality: newAuthorityNationality.trim() || null,
      life_roles: newAuthorityLifeRole ? [newAuthorityLifeRole] : null,
      birth_date_display: newAuthorityBirthDate.trim() || null,
      death_date_display: newAuthorityDeathDate.trim() || null,
    }),
    onSuccess: (newAuthority) => {
      // Invalidate authorities cache
      queryClient.invalidateQueries({ queryKey: ['authorities-search', organizationId] });
      // Now link the newly created authority
      setSelectedAuthorityId(newAuthority.authority_id);
      linkMutation.mutate();
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const linkMutation = useMutation({
    mutationFn: () => linkObjectAuthority(organizationId, objectId, {
      authority_id: selectedAuthorityId || '', // Will be set by createAuthorityMutation on success
      role,
      role_qualifier: roleQualifier || undefined,
      attribution_certainty: certainty || undefined,
      display_name_override: displayNameOverride || undefined,
      notes: notes || undefined,
    }),
    onSuccess,
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  // Direct link mutation for when we have selectedAuthorityId
  const directLinkMutation = useMutation({
    mutationFn: (authorityId: string) => linkObjectAuthority(organizationId, objectId, {
      authority_id: authorityId,
      role,
      role_qualifier: roleQualifier || undefined,
      attribution_certainty: certainty || undefined,
      display_name_override: displayNameOverride || undefined,
      notes: notes || undefined,
    }),
    onSuccess,
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const handleSubmitClick = () => {
    setError(null);

    if (mode === 'create') {
      if (!newAuthorityName.trim()) {
        setError('Please enter a name for the new biography');
        return;
      }
      // Create biography first, then link
      createAuthorityMutation.mutate();
    } else {
      if (!selectedAuthorityId) {
        setError('Please select a biography');
        return;
      }
      directLinkMutation.mutate(selectedAuthorityId);
    }
  };

  const switchToCreate = () => {
    setMode('create');
    // Pre-fill the name with search query if it exists
    if (searchQuery && !newAuthorityName) {
      setNewAuthorityName(searchQuery);
    }
  };

  const switchToSearch = () => {
    setMode('search');
  };

  const isPending = createAuthorityMutation.isPending || linkMutation.isPending || directLinkMutation.isPending;
  const canSubmit = mode === 'create' ? newAuthorityName.trim().length > 0 : !!selectedAuthorityId;

  return (
    <SlideOver
      isOpen={isOpen}
      onClose={onClose}
      title={mode === 'create' ? 'Create & Link Biography' : 'Link Biography'}
      subtitle={mode === 'create' ? 'Create a new biography record and link it' : 'Search for an existing biography or create new'}
      width="md"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-secondary">
            Cancel
          </button>
          <button
            onClick={handleSubmitClick}
            disabled={isPending || !canSubmit}
            className="btn btn-primary"
          >
            {isPending ? (
              <>
                <Loader2 size={16} className="animate-spin mr-2" />
                {mode === 'create' ? 'Creating...' : 'Linking...'}
              </>
            ) : mode === 'create' ? (
              'Create & Link'
            ) : (
              'Link Biography'
            )}
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        {error && (
          <div className="p-3 bg-semantic-error/10 border border-semantic-error/30 rounded-institutional text-sm text-semantic-error">
            {error}
          </div>
        )}

        {mode === 'search' ? (
          <>
            {/* Biography Search */}
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">
                Search Biographies <span className="text-semantic-error">*</span>
              </label>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by name..."
                className="input w-full mb-2"
              />
              <div className="max-h-48 overflow-y-auto border border-lichen rounded-institutional">
                {loadingAuthorities ? (
                  <div className="p-4 text-center text-archive">
                    <Loader2 size={16} className="inline animate-spin mr-2" />
                    Searching...
                  </div>
                ) : searchQuery.length <= 1 ? (
                  <div className="p-4 text-center text-archive text-sm">Type to search...</div>
                ) : authoritiesData?.items?.length === 0 ? (
                  <div className="p-4 text-center">
                    <p className="text-archive text-sm mb-3">No biographies found for &quot;{searchQuery}&quot;</p>
                    <button
                      type="button"
                      onClick={switchToCreate}
                      className="inline-flex items-center gap-1.5 text-sm text-bark hover:text-copper-dark font-medium"
                    >
                      <UserPlus size={16} />
                      Create &quot;{searchQuery}&quot; as new biography
                    </button>
                  </div>
                ) : (
                  <>
                    {authoritiesData?.items?.map((auth: PersonAuthority) => (
                      <button
                        key={auth.authority_id}
                        type="button"
                        onClick={() => setSelectedAuthorityId(auth.authority_id)}
                        className={`w-full text-left px-3 py-2.5 hover:bg-stone/50 flex items-center gap-2 border-b border-lichen last:border-b-0 ${
                          selectedAuthorityId === auth.authority_id ? 'bg-azurite/10 border-l-2 border-l-azurite' : ''
                        }`}
                      >
                        <User size={16} className="text-archive" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-ink font-medium">{auth.preferred_name}</p>
                          <p className="text-xs text-archive">
                            {[auth.nationality, auth.birth_date_display && `b. ${auth.birth_date_display}`]
                              .filter(Boolean)
                              .join(' \u00b7 ') || 'No details'}
                          </p>
                        </div>
                        {auth.is_verified && (
                          <CheckCircle size={14} className="text-forest shrink-0" />
                        )}
                      </button>
                    ))}
                  </>
                )}
              </div>

              {/* Create new option - always visible */}
              <button
                type="button"
                onClick={switchToCreate}
                className="mt-2 w-full text-left px-3 py-2 border border-dashed border-lichen rounded-institutional hover:bg-stone/30 flex items-center gap-2 text-sm text-archive hover:text-ink transition-colors"
              >
                <UserPlus size={16} />
                <span>Create new biography record</span>
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Create New Authority Form */}
            <div>
              <button
                type="button"
                onClick={switchToSearch}
                className="flex items-center gap-1 text-sm text-archive hover:text-ink mb-4"
              >
                <ArrowLeft size={14} />
                Back to search
              </button>

              <div className="p-4 bg-stone/30 rounded-institutional space-y-4">
                <h4 className="text-sm font-medium text-ink flex items-center gap-2">
                  <UserPlus size={16} />
                  New Biography Details
                </h4>

                <div>
                  <label className="block text-sm font-medium text-ink mb-1">
                    Name <span className="text-semantic-error">*</span>
                  </label>
                  <input
                    type="text"
                    value={newAuthorityName}
                    onChange={(e) => setNewAuthorityName(e.target.value)}
                    placeholder="e.g., Vincent van Gogh"
                    className="input w-full"
                    autoFocus
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-ink mb-1">Nationality</label>
                    <input
                      type="text"
                      value={newAuthorityNationality}
                      onChange={(e) => setNewAuthorityNationality(e.target.value)}
                      placeholder="e.g., Dutch"
                      className="input w-full"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-ink mb-1">Role/Profession</label>
                    <select
                      value={newAuthorityLifeRole}
                      onChange={(e) => setNewAuthorityLifeRole(e.target.value)}
                      className="input w-full"
                    >
                      <option value="">Select...</option>
                      {LIFE_ROLE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-ink mb-1">Birth Date</label>
                    <input
                      type="text"
                      value={newAuthorityBirthDate}
                      onChange={(e) => setNewAuthorityBirthDate(e.target.value)}
                      placeholder="e.g., 1853"
                      className="input w-full"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-ink mb-1">Death Date</label>
                    <input
                      type="text"
                      value={newAuthorityDeathDate}
                      onChange={(e) => setNewAuthorityDeathDate(e.target.value)}
                      placeholder="e.g., 1890"
                      className="input w-full"
                    />
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Link details - shown in both modes */}
        <div className="border-t border-lichen pt-5">
          <h4 className="text-sm font-medium text-ink mb-4">Link Details</h4>
          <LinkDetailsForm
            role={role}
            onRoleChange={setRole}
            roleQualifier={roleQualifier}
            onRoleQualifierChange={setRoleQualifier}
            certainty={certainty}
            onCertaintyChange={setCertainty}
            displayNameOverride={displayNameOverride}
            onDisplayNameOverrideChange={setDisplayNameOverride}
            notes={notes}
            onNotesChange={setNotes}
            idPrefix="add-"
          />
        </div>
      </div>
    </SlideOver>
  );
}
