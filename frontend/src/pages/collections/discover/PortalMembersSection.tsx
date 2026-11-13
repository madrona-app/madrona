/**
 * Discover settings > Portal members.
 *
 * Staff switch saved personal collections on or off for the public portal,
 * invite people by email, approve or suspend them, and create a one-time
 * sign-in link for a member (the fallback when this deployment cannot send
 * email). Changes here save immediately; they are not part of the page's
 * "Save Changes" form.
 */
import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Mail, UserPlus, Users } from 'lucide-react';
import ConfirmDialog from '../../../components/ConfirmDialog';
import {
  approvePortalMember,
  generatePortalMemberSignInLink,
  invitePortalMember,
  listPortalMembers,
  setMemberCollectionsEnabled,
  suspendPortalMember,
} from '../../../lib/api/discoverMembers';
import type { StaffPortalMember, StaffSignInLink } from '../../../lib/api/discoverMembers';
import { ApiError } from '../../../lib/apiClient';
import { formatDateTime } from '@/lib/formatters';

const INPUT_CLASS =
  'min-h-[44px] px-3 py-2 rounded border border-archive bg-parchment-warm text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2';
const SMALL_BUTTON =
  'inline-flex items-center gap-1.5 min-h-[44px] px-3 py-2 rounded border border-lichen bg-parchment text-sm text-ink hover:bg-stone transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2';

const STATUS_LABEL: Record<StaffPortalMember['status'], string> = {
  invited: 'Invited, not approved',
  active: 'Approved',
  suspended: 'Suspended',
};

function messageFor(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.status < 500 && err.message) return err.message;
  return fallback;
}

export function PortalMembersSection({ organizationId }: { organizationId: string }) {
  const queryClient = useQueryClient();
  const queryKey = ['portal-members', organizationId];
  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: () => listPortalMembers(organizationId),
    enabled: !!organizationId,
  });

  const [status, setStatus] = useState('');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [approveNow, setApproveNow] = useState(true);
  const [inviteError, setInviteError] = useState('');
  const [pendingSuspend, setPendingSuspend] = useState<StaffPortalMember | null>(null);
  const [link, setLink] = useState<{ member: StaffPortalMember; link: StaffSignInLink } | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const linkInputRef = useRef<HTMLInputElement>(null);

  const announce = (message: string) => {
    setStatus('');
    window.setTimeout(() => setStatus(message), 50);
  };
  const refresh = () => queryClient.invalidateQueries({ queryKey });

  const toggleMutation = useMutation({
    mutationFn: (enabled: boolean) => setMemberCollectionsEnabled(organizationId, enabled),
    onSuccess: async (enabled) => {
      await refresh();
      announce(enabled ? 'Saved collections are now on for the public portal.' : 'Saved collections are now off. Members cannot sign in.');
    },
    onError: (err) => announce(messageFor(err, 'The setting could not be changed. Try again.')),
  });

  const inviteMutation = useMutation({
    mutationFn: () => invitePortalMember(organizationId, {
      email: email.trim(),
      display_name: displayName.trim() || null,
      approve: approveNow,
    }),
    onSuccess: async (m) => {
      setEmail('');
      setDisplayName('');
      await refresh();
      announce(m.status === 'active' ? `Added and approved ${m.email}.` : `Invited ${m.email}. Approve them before they can sign in.`);
      emailRef.current?.focus();
    },
    onError: (err) => {
      setInviteError(messageFor(err, 'The member could not be added. Try again.'));
      emailRef.current?.focus();
    },
  });

  const runAction = async (fn: () => Promise<unknown>, success: string, failure: string) => {
    try {
      await fn();
      await refresh();
      announce(success);
    } catch (err) {
      announce(messageFor(err, failure));
    }
  };

  const createLink = async (member: StaffPortalMember, sendEmail: boolean) => {
    try {
      const result = await generatePortalMemberSignInLink(organizationId, member.member_id, sendEmail);
      if (sendEmail) {
        if (result.emailed) {
          setLink(null);
          announce(`Sign-in link emailed to ${member.email}. It expires in ${result.expires_in_minutes} minutes.`);
          return;
        }
        announce(`The email to ${member.email} could not be sent. Copy the link below and give it to them instead.`);
      } else {
        announce(`Sign-in link created for ${member.email}. It expires in ${result.expires_in_minutes} minutes.`);
      }
      setLink({ member, link: result });
      window.setTimeout(() => linkInputRef.current?.focus(), 0);
    } catch (err) {
      announce(messageFor(err, 'The sign-in link could not be created. Try again.'));
    }
  };

  const copyLink = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.link.url);
      announce('Sign-in link copied to the clipboard.');
    } catch {
      linkInputRef.current?.select();
      announce('Could not copy automatically. The link is selected; copy it with your keyboard.');
    }
  };

  const handleInvite = (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !email.includes('@')) {
      setInviteError('Enter the member’s email address.');
      emailRef.current?.focus();
      return;
    }
    setInviteError('');
    inviteMutation.mutate();
  };

  const enabled = data?.member_collections_enabled ?? false;
  const members = data?.members ?? [];

  return (
    <section aria-labelledby="portal-members-heading" className="mb-10">
      <div className="flex items-center gap-2 mb-2">
        <Users size={18} className="text-bark" aria-hidden="true" />
        <h3 id="portal-members-heading" className="text-sm font-semibold text-ink uppercase tracking-wide">
          Portal members and saved collections
        </h3>
      </div>
      <p className="text-sm text-archive mb-4 max-w-prose">
        Approved members can sign in to the public portal with an emailed one-time link and save objects into
        personal collections. Only people on this list who are approved can sign in. Changes in this section save
        immediately.
      </p>

      <p role="status" aria-live="polite" className="text-sm text-ink min-h-[1.25rem] mb-3">
        {status}
      </p>

      {isLoading ? (
        <p className="text-sm text-archive">Loading members…</p>
      ) : error ? (
        <p role="alert" className="text-sm text-semantic-error">
          {messageFor(error, 'Portal members could not be loaded.')}
        </p>
      ) : (
        <>
          <div className="flex items-start gap-3 mb-6 min-h-[44px]">
            <input
              id="member-collections-enabled"
              type="checkbox"
              className="mt-1 h-5 w-5 accent-bark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
              checked={enabled}
              onChange={(e) => toggleMutation.mutate(e.target.checked)}
              aria-describedby="member-collections-enabled-help"
            />
            <div>
              <label htmlFor="member-collections-enabled" className="text-sm font-medium text-ink">
                Let approved members save personal collections on the public portal
              </label>
              <p id="member-collections-enabled-help" className="text-xs text-archive">
                While this is off, sign-in and saved collections are hidden from the portal and members cannot sign in.
              </p>
            </div>
          </div>

          <form onSubmit={handleInvite} noValidate className="mb-6 p-4 rounded border border-lichen bg-parchment-warm">
            <h4 className="text-sm font-medium text-ink mb-3">Add a member</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label htmlFor="portal-member-email" className="text-sm text-ink">
                  Email address
                </label>
                <input
                  ref={emailRef}
                  id="portal-member-email"
                  type="email"
                  autoComplete="off"
                  required
                  aria-required="true"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  aria-invalid={inviteError ? true : undefined}
                  aria-describedby={inviteError ? 'portal-member-email-error' : undefined}
                  className={INPUT_CLASS}
                />
                {inviteError && (
                  <p id="portal-member-email-error" className="text-sm text-semantic-error">
                    {inviteError}
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="portal-member-name" className="text-sm text-ink">
                  Name (optional)
                </label>
                <input
                  id="portal-member-name"
                  type="text"
                  autoComplete="off"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className={INPUT_CLASS}
                />
              </div>
            </div>
            <div className="flex items-center gap-2 mt-3 min-h-[44px]">
              <input
                id="portal-member-approve"
                type="checkbox"
                className="h-5 w-5 accent-bark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                checked={approveNow}
                onChange={(e) => setApproveNow(e.target.checked)}
              />
              <label htmlFor="portal-member-approve" className="text-sm text-ink">
                Approve now, so they can sign in straight away
              </label>
            </div>
            <button type="submit" className="btn-primary min-h-[44px] mt-2 inline-flex items-center gap-1.5">
              <UserPlus size={16} aria-hidden="true" />
              Add member
            </button>
          </form>

          {link && (
            <div className="mb-6 p-4 rounded border border-azurite/40 bg-azurite/5">
              <label htmlFor="portal-member-link" className="text-sm font-medium text-ink">
                One-time sign-in link for {link.member.email} (expires in {link.link.expires_in_minutes} minutes)
              </label>
              <div className="flex flex-wrap gap-2 mt-1">
                <input
                  ref={linkInputRef}
                  id="portal-member-link"
                  type="text"
                  readOnly
                  value={link.link.url}
                  onFocus={(e) => e.currentTarget.select()}
                  className={`${INPUT_CLASS} flex-1 min-w-0 font-mono text-xs`}
                  aria-describedby="portal-member-link-help"
                />
                <button type="button" className={SMALL_BUTTON} onClick={copyLink}>
                  <Copy size={16} aria-hidden="true" />
                  Copy link
                </button>
              </div>
              <p id="portal-member-link-help" className="text-xs text-archive mt-1">
                Give this link only to {link.member.email}. It signs them in once; creating another link cancels this one.
                {!enabled && ' Saved collections are switched off, so the link will not work until you switch them on.'}
              </p>
            </div>
          )}

          {members.length === 0 ? (
            <p className="text-sm text-ink">No portal members yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left border-collapse">
                <caption className="text-left text-sm font-medium text-ink mb-2">
                  Portal members ({members.length})
                </caption>
                <thead>
                  <tr className="border-b border-lichen">
                    <th scope="col" className="py-2 pr-3 font-medium text-ink">Email</th>
                    <th scope="col" className="py-2 pr-3 font-medium text-ink">Name</th>
                    <th scope="col" className="py-2 pr-3 font-medium text-ink">Status</th>
                    <th scope="col" className="py-2 pr-3 font-medium text-ink">Last signed in</th>
                    <th scope="col" className="py-2 pr-3 font-medium text-ink">Collections</th>
                    <th scope="col" className="py-2 font-medium text-ink">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => (
                    <tr key={m.member_id} className="border-b border-lichen align-top">
                      <th scope="row" className="py-2 pr-3 font-normal text-ink break-all">{m.email}</th>
                      <td className="py-2 pr-3 text-ink">{m.display_name || '—'}</td>
                      <td className="py-2 pr-3 text-ink">{STATUS_LABEL[m.status]}</td>
                      <td className="py-2 pr-3 text-ink">{m.last_sign_in_at ? formatDateTime(m.last_sign_in_at) : 'Never'}</td>
                      <td className="py-2 pr-3 text-ink">{m.collection_count}</td>
                      <td className="py-2">
                        <div className="flex flex-wrap gap-2">
                          {m.status !== 'active' && (
                            <button
                              type="button"
                              className={SMALL_BUTTON}
                              aria-label={`${m.status === 'suspended' ? 'Reactivate' : 'Approve'} ${m.email}`}
                              onClick={() => runAction(
                                () => approvePortalMember(organizationId, m.member_id),
                                `Approved ${m.email}. They can now sign in.`,
                                `${m.email} could not be approved. Try again.`,
                              )}
                            >
                              {m.status === 'suspended' ? 'Reactivate' : 'Approve'}
                            </button>
                          )}
                          {m.status === 'active' && (
                            <>
                              <button
                                type="button"
                                className={SMALL_BUTTON}
                                aria-label={`Email link to ${m.email}`}
                                onClick={() => createLink(m, true)}
                              >
                                <Mail size={16} aria-hidden="true" />
                                Email link
                              </button>
                              <button
                                type="button"
                                className={SMALL_BUTTON}
                                aria-label={`Create link for ${m.email}`}
                                onClick={() => createLink(m, false)}
                              >
                                Create link
                              </button>
                              <button
                                type="button"
                                className={SMALL_BUTTON}
                                aria-label={`Suspend ${m.email}`}
                                onClick={() => setPendingSuspend(m)}
                              >
                                Suspend
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        isOpen={pendingSuspend !== null}
        onClose={() => setPendingSuspend(null)}
        onConfirm={() => {
          const m = pendingSuspend;
          if (!m) return;
          if (link?.member.member_id === m.member_id) setLink(null);
          void runAction(
            () => suspendPortalMember(organizationId, m.member_id),
            `Suspended ${m.email}. They have been signed out and cannot sign in.`,
            `${m.email} could not be suspended. Try again.`,
          );
        }}
        title={pendingSuspend ? `Suspend ${pendingSuspend.email}?` : 'Suspend member?'}
        message="They will be signed out, any sign-in link they hold stops working, and they cannot sign in until you reactivate them. Their saved collections are kept."
        confirmText="Suspend member"
        confirmStyle="danger"
      />
    </section>
  );
}
