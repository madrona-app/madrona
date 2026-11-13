/**
 * Automated accessibility checks for the media screens' key components: the
 * folder navigation, move-to-folder dialog, batch metadata editor, rights and
 * consent dialogs, new-version upload, the tag (metadata field) editor and the
 * record section navigation. Each runs axe over the rendered DOM and checks the
 * roles, names and keyboard behaviour of its main controls.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { FolderTree } from '../../components/dam/FolderTree';
import { MoveToFolderModal } from '../../components/dam/MoveToFolderModal';
import { BatchMetadataPanel } from '../../components/dam/BatchMetadataPanel';
import { AddRightsModal } from '../../components/dam/AddRightsModal';
import { AddConsentModal } from '../../components/dam/AddConsentModal';
import { UploadVersionModal } from '../../components/dam/UploadVersionModal';
import { MediaTagsManager } from '../../components/dam/MediaTagsManager';
import { MediaDetailTabs } from '../../pages/media/MediaDetailPage/MediaDetailTabs';
import { RightsTabContent } from '../../pages/media/MediaDetailPage/RightsTabContent';
import { computeRightsStatus } from '../../pages/media/MediaDetailPage/types';
import * as api from '../../lib/api';
import type { MediaFolder } from '../../lib/schemas';
import { checkA11y, formatViolations } from '../a11y';

vi.mock('../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api')>()),
  listMediaFolders: vi.fn(),
  moveMediaToFolder: vi.fn(),
  batchMediaOperation: vi.fn(),
  createMediaRights: vi.fn(),
  updateMediaRights: vi.fn(),
  createMediaConsent: vi.fn(),
  updateMediaConsent: vi.fn(),
  uploadConsentDocument: vi.fn(),
  uploadMediaVersion: vi.fn(),
  listTagDefinitions: vi.fn(),
  getMediaTags: vi.fn(),
  setMediaTag: vi.fn(),
  deleteMediaTag: vi.fn(),
  listTagValuesForDefinition: vi.fn(),
  listMediaRights: vi.fn(),
  listMediaConsents: vi.fn(),
  publishMedia: vi.fn(),
  unpublishMedia: vi.fn(),
}));

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({
    hasAppAccess: () => true,
    user: { permissions: [], ai_tagging_enabled: true, transcription_enabled: true },
  }),
}));

function withProviders(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/organizations/org-1/media/m-1']}>
        <Routes>
          <Route path="/organizations/:orgId/media/:mediaId/*" element={ui} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function expectNoViolations(container: Element) {
  const results = await checkA11y(container);
  expect(results.violations, formatViolations(results)).toEqual([]);
}

const folders: MediaFolder[] = [
  { folder_id: 'f-1', name: 'Photography', parent_folder_id: null, depth: 0, sort_order: 0, media_count: 4 },
  { folder_id: 'f-2', name: 'Exhibitions', parent_folder_id: 'f-1', depth: 1, sort_order: 0, media_count: 0 },
] as MediaFolder[];

describe('FolderTree accessibility', () => {
  beforeEach(() => {
    vi.mocked(api.listMediaFolders).mockResolvedValue({ folders, unfiled_count: 2 } as never);
  });

  it('has no axe violations and exposes folders as named buttons in a navigation landmark', async () => {
    const onSelect = vi.fn();
    const { container } = withProviders(
      <FolderTree organizationId="org-1" selectedFolderId="f-1" onSelectFolder={onSelect} onCreateFolder={vi.fn()} />,
    );
    await screen.findByText('Photography');

    expect(screen.getByRole('navigation', { name: 'Media folders' })).toBeInTheDocument();
    const photo = screen.getByRole('button', { name: /^Photography/ });
    expect(photo).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: 'Expand Photography' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: 'More options for Photography' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Unfiled/ }));
    expect(onSelect).toHaveBeenCalledWith('unfiled');

    await expectNoViolations(container);
  });
});

describe('MoveToFolderModal accessibility', () => {
  beforeEach(() => {
    vi.mocked(api.listMediaFolders).mockResolvedValue({ folders } as never);
  });

  it('is a labelled dialog with selectable destinations and no axe violations', async () => {
    const onClose = vi.fn();
    const { container } = withProviders(
      <MoveToFolderModal organizationId="org-1" mediaIds={['m-1', 'm-2']} currentFolderId="f-1" onClose={onClose} />,
    );
    await screen.findByText('Photography');

    expect(screen.getByRole('dialog', { name: 'Move 2 items' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Photography.*current folder/ })).toBeDisabled();
    // Root is the default destination when the items are in a folder
    const root = screen.getByRole('button', { name: 'Root (No folder)' });
    expect(root).toHaveAttribute('aria-pressed', 'true');
    const expand = screen.getByRole('button', { name: 'Expand Photography' });
    fireEvent.click(expand);
    expect(screen.getByRole('button', { name: 'Collapse Photography' })).toHaveAttribute('aria-expanded', 'true');
    const exhibitions = screen.getByRole('button', { name: 'Exhibitions' });
    fireEvent.click(exhibitions);
    expect(exhibitions).toHaveAttribute('aria-pressed', 'true');
    expect(root).toHaveAttribute('aria-pressed', 'false');

    await expectNoViolations(container);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});

describe('BatchMetadataPanel accessibility', () => {
  it('uses the tabs pattern with arrow-key navigation and has no axe violations', async () => {
    const { container } = withProviders(
      <BatchMetadataPanel organizationId="org-1" selectedMediaIds={['m-1', 'm-2']} onClose={vi.fn()} />,
    );

    const tags = screen.getByRole('tab', { name: 'Tags' });
    expect(tags).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: 'Tags' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Add Tags' })).toBeInTheDocument();
    await expectNoViolations(container);

    fireEvent.keyDown(tags, { key: 'ArrowRight' });
    const fields = screen.getByRole('tab', { name: 'Fields' });
    expect(fields).toHaveAttribute('aria-selected', 'true');
    expect(fields).toHaveFocus();
    expect(screen.getByRole('checkbox', { name: 'Add Title Prefix' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Title prefix' })).toBeInTheDocument();
    await expectNoViolations(container);

    fireEvent.keyDown(fields, { key: 'End' });
    expect(screen.getByRole('tab', { name: 'Credits' })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('Rights and consent dialogs accessibility', () => {
  it('AddRightsModal labels every field and has no axe violations', async () => {
    const { container } = withProviders(
      <AddRightsModal isOpen organizationId="org-1" mediaId="m-1" onClose={vi.fn()} />,
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    for (const name of [/Rights Type/, 'Rights Status', 'Rights Holder', 'License Type', 'License URL', 'Rights Statement', 'Territory', 'Start Date', 'End Date', 'Usage Restrictions']) {
      expect(screen.getByLabelText(name)).toBeInTheDocument();
    }
    await expectNoViolations(container);
  });

  it('AddConsentModal labels every field and has no axe violations', async () => {
    const { container } = withProviders(
      <AddConsentModal isOpen organizationId="org-1" mediaId="m-1" onClose={vi.fn()} />,
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    for (const name of [/Subject Name/, 'Subject Role', 'Consent Type', 'Consent Scope', 'Consent Date', 'Expiry Date', 'Notes']) {
      expect(screen.getByLabelText(name)).toBeInTheDocument();
    }
    await expectNoViolations(container);
  });
});

describe('UploadVersionModal accessibility', () => {
  it('offers the drop zone as a keyboard-operable button and has no axe violations', async () => {
    const { container } = withProviders(
      <UploadVersionModal organizationId="org-1" mediaId="m-1" onClose={vi.fn()} />,
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Drop file here or click to browse/ })).toBeInTheDocument();
    expect(screen.getByLabelText(/Change Note/)).toBeInTheDocument();
    await expectNoViolations(container);
  });
});

describe('MediaTagsManager accessibility', () => {
  beforeEach(() => {
    const base = { organization_id: 'org-1', is_required: false, sort_order: 0, is_active: true, allow_multiple: false };
    vi.mocked(api.listTagDefinitions).mockResolvedValue({
      definitions: [
        { ...base, definition_id: 'd-1', tag_key: 'project', display_name: 'Project', field_type: 'text' },
        { ...base, definition_id: 'd-2', tag_key: 'shot', display_name: 'Shot date', field_type: 'date' },
        { ...base, definition_id: 'd-3', tag_key: 'kw', display_name: 'Keywords', field_type: 'dynamic_keywords', allow_multiple: true },
        { ...base, definition_id: 'd-4', tag_key: 'cat', display_name: 'Category', field_type: 'category_tree', allow_multiple: true },
      ],
    } as never);
    vi.mocked(api.getMediaTags).mockResolvedValue({ tags: [] } as never);
    vi.mocked(api.listTagValuesForDefinition).mockResolvedValue({ values: [] } as never);
  });

  it('labels each tag field and has no axe violations', async () => {
    const { container } = withProviders(<MediaTagsManager organizationId="org-1" mediaId="m-1" />);
    await screen.findByText(/Project/);

    expect(screen.getByRole('textbox', { name: /Project/ })).toBeInTheDocument();
    expect(screen.getByLabelText(/Shot date/)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /Keywords/ })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /Category/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Click to choose…' })).toHaveAttribute('aria-expanded', 'false');

    await waitFor(() => expect(api.listTagValuesForDefinition).toHaveBeenCalled());
    await expectNoViolations(container);
  });
});

describe('MediaDetailTabs accessibility', () => {
  it('is a named navigation with the current section marked, and has no axe violations', async () => {
    const { container } = withProviders(
      <MediaDetailTabs
        mediaType="image"
        activeTab="details"
        onTabChange={vi.fn()}
        rightsStatus={computeRightsStatus([])}
        basePath="/organizations/org-1/media/m-1"
      />,
    );
    expect(screen.getByRole('navigation', { name: 'Media record sections' })).toBeInTheDocument();
    expect(screen.getAllByRole('button').some((b) => b.getAttribute('aria-current') === 'page')).toBe(true);
    await expectNoViolations(container);
  });
});

describe('Media rights tab accessibility', () => {
  beforeEach(() => {
    vi.mocked(api.listMediaRights).mockResolvedValue({ rights: [] } as never);
    vi.mocked(api.listMediaConsents).mockResolvedValue({ consents: [] } as never);
  });

  it('has no axe violations and a named publish switch', async () => {
    const client = new QueryClient();
    const { container } = withProviders(
      <RightsTabContent
        organizationId="org-1"
        mediaId="m-1"
        media={{ media_id: 'm-1', media_type: 'image', is_published: false, metadata_reviewed: false }}
        rightsStatus={computeRightsStatus([])}
        usageStats={null}
        queryClient={client}
        reviewMetadataMutation={{ mutate: vi.fn(), isPending: false }}
        clearReviewMutation={{ mutate: vi.fn(), isPending: false }}
      />,
    );
    await waitFor(() => expect(api.listMediaRights).toHaveBeenCalled());
    await screen.findByText('Rights Information');

    expect(screen.getByRole('switch', { name: 'Publicly published' })).toHaveAttribute('aria-checked', 'false');
    await expectNoViolations(container);
  });
});
