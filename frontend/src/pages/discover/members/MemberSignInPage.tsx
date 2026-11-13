/**
 * Member sign-in: ask for an email address and send a one-time link.
 *
 * The confirmation is the same whether or not the address belongs to a
 * member (the API answers identically), and it is announced in a polite
 * live region while focus stays on the form.
 */
import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError } from '../../../lib/apiClient';
import { requestMemberSignInLink } from '../../../lib/api/discoverMembers';
import { MemberPageLayout, MEMBER_LINK_CLASS } from './MemberPageLayout';

export const SIGN_IN_CONFIRMATION = 'If that address belongs to a member, a sign-in link is on its way.';

export default function MemberSignInPage() {
  const { orgSlug = '' } = useParams<{ orgSlug: string }>();
  return (
    <MemberPageLayout orgSlug={orgSlug} title="Sign in">
      {({ member }) =>
        member ? (
          <>
            <h1 className="font-serif text-3xl font-light text-ink mb-4">You are signed in</h1>
            <p className="text-ink mb-4">
              Signed in as {member.display_name || member.email}.
            </p>
            <Link to={`/c/${orgSlug}/member/collections`} className={MEMBER_LINK_CLASS}>
              Go to my collections
            </Link>
          </>
        ) : (
          <SignInForm orgSlug={orgSlug} />
        )
      }
    </MemberPageLayout>
  );
}

function SignInForm({ orgSlug }: { orgSlug: string }) {
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [status, setStatus] = useState('');
  const [failure, setFailure] = useState('');
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    // Not disabled while sending (a disabled button drops keyboard focus).
    if (sending) return;
    setFailure('');
    const value = email.trim();
    if (!value || !value.includes('@')) {
      setFieldError('Enter your email address, for example name@example.org.');
      setStatus('');
      inputRef.current?.focus();
      return;
    }
    setFieldError('');
    setSending(true);
    setStatus('');
    try {
      await requestMemberSignInLink(orgSlug, value);
      setStatus(SIGN_IN_CONFIRMATION);
    } catch (err) {
      setFailure(
        err instanceof ApiError && err.status === 429
          ? 'Too many sign-in requests. Wait 15 minutes, then try again.'
          : 'The sign-in link could not be requested. Try again in a moment.',
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <h1 className="font-serif text-3xl font-light text-ink mb-4">Sign in to your saved collections</h1>
      <p className="text-ink mb-6 max-w-prose">
        Saved collections are for approved members. Enter the email address the collection has on file and we
        will email you a link that signs you in. The link works once and expires after 15 minutes. There is no
        password.
      </p>
      <form onSubmit={handleSubmit} noValidate className="max-w-md flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="member-sign-in-email" className="text-sm font-medium text-ink">
            Email address
          </label>
          <input
            ref={inputRef}
            id="member-sign-in-email"
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            aria-required="true"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={fieldError ? true : undefined}
            aria-describedby={fieldError ? 'member-sign-in-email-error' : undefined}
            className="min-h-[44px] px-3 py-2 rounded border border-archive bg-parchment-warm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
          />
          {fieldError && (
            <p id="member-sign-in-email-error" className="text-sm text-semantic-error">
              {fieldError}
            </p>
          )}
        </div>
        <div>
          <button type="submit" className="btn-primary min-h-[44px]" aria-disabled={sending || undefined}>
            {sending ? 'Sending…' : 'Email me a sign-in link'}
          </button>
        </div>
        <p role="status" aria-live="polite" className="text-sm text-ink min-h-[1.25rem]">
          {status}
        </p>
        {failure && (
          <p role="alert" className="text-sm text-semantic-error">
            {failure}
          </p>
        )}
      </form>
      <p className="mt-8">
        <Link to={`/c/${orgSlug}`} className={MEMBER_LINK_CLASS}>
          Back to the collection
        </Link>
      </p>
    </>
  );
}
