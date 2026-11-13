import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HelmetProvider } from 'react-helmet-async';
import { checkA11y } from '../../../a11y';
import * as members from '../../../../lib/api/discoverMembers';
import MemberSignInPage, { SIGN_IN_CONFIRMATION } from '../../../../pages/discover/members/MemberSignInPage';
import MyCollectionsPage from '../../../../pages/discover/members/MyCollectionsPage';
import MemberCollectionPage from '../../../../pages/discover/members/MemberCollectionPage';
import MemberWelcomePage from '../../../../pages/discover/members/MemberWelcomePage';
import { SaveToCollection } from '../../../../pages/discover/members/SaveToCollection';

vi.mock('../../../../lib/api', () => ({
  getDiscoverInfo: vi.fn().mockResolvedValue({ organization_name: 'Federation Archive' }),
}));

vi.mock('../../../../pages/discover/components/CollectionSiteShell', () => ({
  CollectionSiteShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('../../../../lib/api/discoverMembers', () => ({
  getMemberSession: vi.fn(),
  requestMemberSignInLink: vi.fn(),
  exchangeMemberSignInLink: vi.fn(),
  memberSignOut: vi.fn(),
  listMemberCollections: vi.fn(),
  createMemberCollection: vi.fn(),
  getMemberCollection: vi.fn(),
  updateMemberCollection: vi.fn(),
  deleteMemberCollection: vi.fn(),
  addObjectToMemberCollection: vi.fn(),
  removeObjectFromMemberCollection: vi.fn(),
  getMemberCollectionExportUrl: (slug: string, id: string, fmt: string) =>
    `/api/discover/${slug}/member/collections/${id}/export?format=${fmt}`,
}));

const api = vi.mocked(members);
const MEMBER = { display_name: 'Ada', email: 'ada@example.org' };

function renderAt(path: string, routePath: string, element: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <HelmetProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path={routePath} element={element} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </HelmetProvider>,
  );
}

const collections = [
  { collection_id: 'c1', name: 'Braille history', description: 'For my talk', item_count: 2, contains_object: false },
  { collection_id: 'c2', name: 'Letters', description: null, item_count: 1, contains_object: true },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Member sign-in page', () => {
  it('asks for an email and announces the same confirmation for any address', async () => {
    api.getMemberSession.mockResolvedValue({ enabled: true, member: null });
    api.requestMemberSignInLink.mockResolvedValue(SIGN_IN_CONFIRMATION);
    const { container } = renderAt('/c/nfb/member/sign-in', '/c/:orgSlug/member/sign-in', <MemberSignInPage />);

    const input = await screen.findByLabelText('Email address');
    expect(screen.getByRole('heading', { level: 1, name: /sign in to your saved collections/i })).toBeInTheDocument();
    expect((await checkA11y(container)).violations).toEqual([]);

    await userEvent.type(input, 'someone@example.org');
    await userEvent.click(screen.getByRole('button', { name: 'Email me a sign-in link' }));

    const status = screen.getByRole('status');
    await waitFor(() => expect(status).toHaveTextContent(SIGN_IN_CONFIRMATION));
    expect(api.requestMemberSignInLink).toHaveBeenCalledWith('nfb', 'someone@example.org');
    expect((await checkA11y(container)).violations).toEqual([]);
  });

  it('marks an empty address invalid and describes the error', async () => {
    api.getMemberSession.mockResolvedValue({ enabled: true, member: null });
    renderAt('/c/nfb/member/sign-in', '/c/:orgSlug/member/sign-in', <MemberSignInPage />);
    const input = await screen.findByLabelText('Email address');
    await userEvent.click(screen.getByRole('button', { name: 'Email me a sign-in link' }));
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription(/enter your email address/i);
    expect(input).toHaveFocus();
    expect(api.requestMemberSignInLink).not.toHaveBeenCalled();
  });

  it('says the feature is unavailable when the portal has it off', async () => {
    api.getMemberSession.mockResolvedValue({ enabled: false, member: null });
    renderAt('/c/nfb/member/sign-in', '/c/:orgSlug/member/sign-in', <MemberSignInPage />);
    expect(await screen.findByRole('heading', { name: /saved collections are not available/i })).toBeInTheDocument();
    expect(screen.queryByLabelText('Email address')).not.toBeInTheDocument();
  });
});

describe('Sign-in link landing page', () => {
  it('exchanges the token from the fragment and removes it from the address bar', async () => {
    api.getMemberSession.mockResolvedValue({ enabled: true, member: null });
    api.exchangeMemberSignInLink.mockResolvedValue(MEMBER);
    window.history.replaceState(null, '', '/c/nfb/member/welcome#token=abc123');
    renderAt('/c/nfb/member/welcome', '/c/:orgSlug/member/welcome', <MemberWelcomePage />);
    const heading = await screen.findByRole('heading', { name: 'You are signed in' });
    expect(api.exchangeMemberSignInLink).toHaveBeenCalledWith('nfb', 'abc123');
    expect(window.location.hash).toBe('');
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.getByRole('link', { name: 'Go to my collections' })).toBeInTheDocument();
  });

  it('explains a used or expired link', async () => {
    api.getMemberSession.mockResolvedValue({ enabled: true, member: null });
    api.exchangeMemberSignInLink.mockRejectedValue(new Error('invalid'));
    window.history.replaceState(null, '', '/c/nfb/member/welcome#token=used');
    const { container } = renderAt('/c/nfb/member/welcome', '/c/:orgSlug/member/welcome', <MemberWelcomePage />);
    expect(await screen.findByRole('heading', { name: 'Sign-in link not accepted' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Request a new sign-in link' })).toBeInTheDocument();
    expect((await checkA11y(container)).violations).toEqual([]);
  });
});

describe('My collections page', () => {
  beforeEach(() => {
    api.getMemberSession.mockResolvedValue({ enabled: true, member: MEMBER });
    api.listMemberCollections.mockResolvedValue(collections);
  });

  it('lists collections with named rename and delete controls', async () => {
    const { container } = renderAt('/c/nfb/member/collections', '/c/:orgSlug/member/collections', <MyCollectionsPage />);
    expect(await screen.findByRole('link', { name: 'Braille history' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /your collections \(2\)/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rename Braille history' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete Letters' })).toBeInTheDocument();
    expect(screen.getByLabelText('Collection name')).toBeInTheDocument();
    expect((await checkA11y(container)).violations).toEqual([]);
  });

  it('creates a collection and announces it', async () => {
    api.createMemberCollection.mockResolvedValue({ collection_id: 'c3', name: 'Tools', item_count: 0 });
    renderAt('/c/nfb/member/collections', '/c/:orgSlug/member/collections', <MyCollectionsPage />);
    await userEvent.type(await screen.findByLabelText('Collection name'), 'Tools');
    await userEvent.click(screen.getByRole('button', { name: 'Create collection' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Created collection Tools.'));
    expect(api.createMemberCollection).toHaveBeenCalledWith('nfb', { name: 'Tools', description: null });
  });

  it('renames in place and returns focus to the Rename button', async () => {
    api.updateMemberCollection.mockResolvedValue({ ...collections[0], name: 'Braille' });
    renderAt('/c/nfb/member/collections', '/c/:orgSlug/member/collections', <MyCollectionsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Rename Braille history' }));
    const field = screen.getByLabelText('New name for Braille history');
    expect(field).toHaveFocus();
    await userEvent.clear(field);
    await userEvent.type(field, 'Braille');
    await userEvent.click(screen.getByRole('button', { name: 'Save name' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Renamed Braille history to Braille.'));
    expect(api.updateMemberCollection).toHaveBeenCalledWith('nfb', 'c1', { name: 'Braille' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Rename Braille history' })).toHaveFocus());
  });

  it('confirms before deleting, then announces and focuses the list heading', async () => {
    api.deleteMemberCollection.mockResolvedValue(undefined);
    renderAt('/c/nfb/member/collections', '/c/:orgSlug/member/collections', <MyCollectionsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Delete Letters' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete Letters?' });
    expect(api.deleteMemberCollection).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete collection' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Deleted collection Letters.'));
    expect(api.deleteMemberCollection).toHaveBeenCalledWith('nfb', 'c2');
    await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: /your collections/i })).toHaveFocus());
  });

  it('offers a sign-in link when signed out', async () => {
    api.getMemberSession.mockResolvedValue({ enabled: true, member: null });
    renderAt('/c/nfb/member/collections', '/c/:orgSlug/member/collections', <MyCollectionsPage />);
    expect(await screen.findByRole('link', { name: 'Sign in' })).toBeInTheDocument();
    expect(api.listMemberCollections).not.toHaveBeenCalled();
  });
});

describe('Collection page', () => {
  const detail = {
    collection_id: 'c1',
    name: 'Braille history',
    description: 'For my talk',
    item_count: 2,
    items: [
      { object_id: 'o1', note: 'chapter 2', object: { object_id: 'o1', object_number: 'NFB.1', title: 'Perkins Brailler', creators: ['Perkins'], creation_date_display: '1951' } },
      { object_id: 'o2', note: null, object: { object_id: 'o2', object_number: 'NFB.2', title: 'Slate and stylus', creators: [], creation_date_display: null } },
    ],
  };

  beforeEach(() => {
    api.getMemberSession.mockResolvedValue({ enabled: true, member: MEMBER });
    api.getMemberCollection.mockResolvedValue(detail);
  });

  it('shows the objects with Remove buttons named for each object, and export links', async () => {
    const { container } = renderAt('/c/nfb/member/collections/c1', '/c/:orgSlug/member/collections/:collectionId', <MemberCollectionPage />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Braille history' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Perkins Brailler from this collection' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Slate and stylus from this collection' })).toBeInTheDocument();
    const csv = screen.getByRole('link', { name: /download these 2 objects as csv/i });
    expect(csv).toHaveAttribute('href', '/api/discover/nfb/member/collections/c1/export?format=csv');
    expect(screen.getByRole('link', { name: /download these 2 objects as json/i })).toBeInTheDocument();
    expect((await checkA11y(container)).violations).toEqual([]);
  });

  it('removes an object, announces it, and moves focus to the next Remove button', async () => {
    api.removeObjectFromMemberCollection.mockResolvedValue(undefined);
    renderAt('/c/nfb/member/collections/c1', '/c/:orgSlug/member/collections/:collectionId', <MemberCollectionPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Remove Perkins Brailler from this collection' }));
    await waitFor(() =>
      expect(screen.getAllByRole('status').some((s) => s.textContent === 'Removed Perkins Brailler from Braille history.')).toBe(true),
    );
    expect(api.removeObjectFromMemberCollection).toHaveBeenCalledWith('nfb', 'c1', 'o1');
    expect(screen.queryByRole('button', { name: 'Remove Perkins Brailler from this collection' })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove Slate and stylus from this collection' })).toHaveFocus());
  });
});

describe('Save to collection', () => {
  function renderSave() {
    return renderAt(
      '/c/nfb/objects/o1',
      '/c/:orgSlug/objects/:objectId',
      <main>
        <h1>Perkins Brailler</h1>
        <SaveToCollection orgSlug="nfb" objectId="o1" objectTitle="Perkins Brailler" />
      </main>,
    );
  }

  it('is hidden entirely when the feature is off', async () => {
    api.getMemberSession.mockResolvedValue({ enabled: false, member: null });
    const { container } = renderSave();
    await waitFor(() => expect(api.getMemberSession).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /save to collection/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /sign in/i })).not.toBeInTheDocument();
    expect(container.querySelector('main')?.textContent).toBe('Perkins Brailler');
  });

  it('shows only a sign-in link when nobody is signed in', async () => {
    api.getMemberSession.mockResolvedValue({ enabled: true, member: null });
    renderSave();
    const link = await screen.findByRole('link', { name: 'Sign in to save this object to a collection' });
    expect(link).toHaveAttribute('href', '/c/nfb/member/sign-in');
    expect(screen.queryByRole('button', { name: /save to collection/i })).not.toBeInTheDocument();
  });

  it('opens a labelled dialog with a radio group and saves to the chosen collection', async () => {
    api.getMemberSession.mockResolvedValue({ enabled: true, member: MEMBER });
    api.listMemberCollections.mockResolvedValue(collections);
    api.addObjectToMemberCollection.mockResolvedValue({ already_saved: false });
    const { baseElement } = renderSave();

    const open = await screen.findByRole('button', { name: 'Save to collection' });
    await userEvent.click(open);
    const dialog = await screen.findByRole('dialog', { name: 'Save Perkins Brailler to a collection' });
    const group = await within(dialog).findByRole('group', { name: 'Collection' });
    const first = within(group).getByRole('radio', { name: /braille history/i });
    expect(within(group).getByRole('radio', { name: /letters.*already holds this object/i })).toBeInTheDocument();
    expect(within(group).getByRole('radio', { name: 'New collection' })).toBeInTheDocument();
    await waitFor(() => expect(first).toBeChecked());
    await waitFor(() => expect(first).toHaveFocus());
    expect((await checkA11y(baseElement)).violations).toEqual([]);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.addObjectToMemberCollection).toHaveBeenCalledWith('nfb', 'c1', 'o1');
    expect(screen.getByRole('status')).toHaveTextContent('Saved Perkins Brailler to Braille history.');
    expect(screen.getByRole('link', { name: 'View Braille history' })).toHaveAttribute('href', '/c/nfb/member/collections/c1');
    await waitFor(() => expect(open).toHaveFocus());
  });

  it('creates a new collection from the dialog', async () => {
    api.getMemberSession.mockResolvedValue({ enabled: true, member: MEMBER });
    api.listMemberCollections.mockResolvedValue([]);
    api.createMemberCollection.mockResolvedValue({ collection_id: 'c9', name: 'Research', item_count: 0 });
    api.addObjectToMemberCollection.mockResolvedValue({ already_saved: false });
    renderSave();
    await userEvent.click(await screen.findByRole('button', { name: 'Save to collection' }));
    const dialog = await screen.findByRole('dialog');
    const newRadio = await within(dialog).findByRole('radio', { name: 'New collection' });
    await waitFor(() => expect(newRadio).toBeChecked());
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    const nameField = within(dialog).getByLabelText('Name for the new collection');
    expect(nameField).toHaveAttribute('aria-invalid', 'true');
    expect(nameField).toHaveFocus();
    await userEvent.type(nameField, 'Research');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.addObjectToMemberCollection).toHaveBeenCalledWith('nfb', 'c9', 'o1'));
    expect(api.createMemberCollection).toHaveBeenCalledWith('nfb', { name: 'Research' });
  });
});
