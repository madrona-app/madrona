/**
 * Landing page for an emailed sign-in link: /c/:orgSlug/member/welcome#token=…
 *
 * The token is in the URL fragment, which the browser never sends to a
 * server. It is read once, removed from the address bar (and so from
 * history), and exchanged for a session cookie.
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { exchangeMemberSignInLink } from '../../../lib/api/discoverMembers';
import type { PortalMemberIdentity } from '../../../lib/api/discoverMembers';
import { MemberPageLayout, MEMBER_LINK_CLASS } from './MemberPageLayout';
import { memberSessionKey } from './useMemberSession';

type ExchangeState =
  | { kind: 'working' }
  | { kind: 'done'; member: PortalMemberIdentity }
  | { kind: 'failed'; message: string };

function tokenFromHash(): string | null {
  return new URLSearchParams(window.location.hash.replace(/^#/, '')).get('token');
}

function clearHash() {
  if (window.location.hash) {
    window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
  }
}

const MISSING_TOKEN = 'This page needs the sign-in link from your email. Open the link again, or request a new one.';

export default function MemberWelcomePage() {
  const { orgSlug = '' } = useParams<{ orgSlug: string }>();
  return (
    <MemberPageLayout orgSlug={orgSlug} title="Signing in">
      {() => <Exchange orgSlug={orgSlug} />}
    </MemberPageLayout>
  );
}

function Exchange({ orgSlug }: { orgSlug: string }) {
  const queryClient = useQueryClient();
  const [token] = useState(tokenFromHash);
  const [state, setState] = useState<ExchangeState>(() =>
    token ? { kind: 'working' } : { kind: 'failed', message: MISSING_TOKEN },
  );
  const started = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    // Out of the address bar (and history) before anything else happens.
    clearHash();
    if (!token) return;
    exchangeMemberSignInLink(orgSlug, token)
      .then((member) => {
        queryClient.setQueryData(memberSessionKey(orgSlug), { enabled: true, member });
        setState({ kind: 'done', member });
      })
      .catch(() => {
        setState({
          kind: 'failed',
          message: 'This sign-in link is not valid. It may have been used already or expired. Request a new one.',
        });
      });
  }, [orgSlug, queryClient, token]);

  useEffect(() => {
    if (state.kind !== 'working') headingRef.current?.focus();
  }, [state.kind]);

  if (state.kind === 'working') {
    return (
      <>
        <h1 className="font-serif text-3xl font-light text-ink mb-4">Signing you in</h1>
        <p role="status" className="text-ink">Checking your sign-in link…</p>
      </>
    );
  }

  if (state.kind === 'failed') {
    return (
      <>
        <h1 ref={headingRef} tabIndex={-1} className="font-serif text-3xl font-light text-ink mb-4 focus:outline-none">
          Sign-in link not accepted
        </h1>
        <p className="text-ink mb-4">{state.message}</p>
        <Link to={`/c/${orgSlug}/member/sign-in`} className={MEMBER_LINK_CLASS}>
          Request a new sign-in link
        </Link>
      </>
    );
  }

  return (
    <>
      <h1 ref={headingRef} tabIndex={-1} className="font-serif text-3xl font-light text-ink mb-4 focus:outline-none">
        You are signed in
      </h1>
      <p className="text-ink mb-4">Welcome, {state.member.display_name || state.member.email}.</p>
      <ul className="flex flex-col gap-2">
        <li>
          <Link to={`/c/${orgSlug}/member/collections`} className={MEMBER_LINK_CLASS}>
            Go to my collections
          </Link>
        </li>
        <li>
          <Link to={`/c/${orgSlug}`} className={MEMBER_LINK_CLASS}>
            Search the collection
          </Link>
        </li>
      </ul>
    </>
  );
}
