/**
 * Accessibility coverage for the record-linking widgets staff use on every
 * collection record: RecordLinker (and its search slide-over), the
 * location picker, ConstituentLinker, SubjectLinker and the row actions
 * menu. Each renders the real component and checks axe plus the
 * role/name of the controls a keyboard or screen reader user depends on.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Edit2, Trash2 } from 'lucide-react';
import { checkA11y, defaultAxeConfig, formatViolations } from '../../a11y';
import { RecordLinker } from '../../../components/records/RecordLinker';
import {
  LocationPickerModal,
  LocationPickerButton,
  EditableLocationPicker,
} from '../../../components/collections/LocationPickerModal';
import { ConstituentLinker } from '../../../components/collections/ConstituentLinker';
import { SubjectLinker } from '../../../components/collections/SubjectLinker';
import { RowActionsMenu } from '../../../components/collections/RowActionsMenu';

const {
  getLocationsMock,
  getObjectSubjectsMock,
  getObjectConstituentsMock,
  searchConstituentsMock,
  useLookupCategoryMock,
} = vi.hoisted(() => ({
  getLocationsMock: vi.fn(),
  getObjectSubjectsMock: vi.fn(),
  getObjectConstituentsMock: vi.fn(),
  searchConstituentsMock: vi.fn(),
  useLookupCategoryMock: vi.fn(),
}));

vi.mock('../../../lib/api', () => ({
  getLocations: getLocationsMock,
  getObjectSubjects: getObjectSubjectsMock,
  linkObjectSubject: vi.fn(),
  unlinkObjectSubject: vi.fn(),
  getSubjectAuthorities: vi.fn().mockResolvedValue({ items: [] }),
  createSubjectAuthority: vi.fn(),
  searchSubjectsExternal: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../lib/api/constituents', () => ({
  getObjectConstituents: getObjectConstituentsMock,
  addObjectConstituent: vi.fn(),
  removeObjectConstituent: vi.fn(),
  searchConstituents: searchConstituentsMock,
  importUlan: vi.fn(),
  createConstituent: vi.fn(),
}));

vi.mock('../../../hooks/useLookupValues', () => ({
  useLookupCategory: useLookupCategoryMock,
}));

const LOCATIONS = [
  { location_id: 'loc-1', name: 'Main Building', location_type: 'building', status: 'active', parent_id: null, path: 'Main Building', code: 'MB', on_display: false },
  { location_id: 'loc-2', name: 'Gallery A', location_type: 'room', status: 'active', parent_id: 'loc-1', path: 'Main Building > Gallery A', code: null, on_display: true },
  { location_id: 'loc-3', name: 'Storage Room', location_type: 'room', status: 'active', parent_id: 'loc-1', path: 'Main Building > Storage Room', code: null, on_display: false },
];

function wrap(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>
    </MemoryRouter>,
  );
}

async function expectNoViolations(el: Element) {
  // These render a component on its own, not a page, so the page-level
  // "content must be inside landmarks" rule does not apply.
  const results = await checkA11y(el, {
    rules: { ...defaultAxeConfig.rules, region: { enabled: false } },
  });
  expect(results.violations, formatViolations(results)).toHaveLength(0);
}

beforeEach(() => {
  getLocationsMock.mockReset().mockResolvedValue({ items: LOCATIONS });
  getObjectSubjectsMock.mockReset();
  getObjectConstituentsMock.mockReset();
  searchConstituentsMock.mockReset().mockResolvedValue([]);
  useLookupCategoryMock.mockReset().mockReturnValue({
    options: [{ value: 'creator', label: 'Creator' }],
    values: [],
    getLabel: (v: string) => v,
    isLoading: false,
  });
});

// ---------------------------------------------------------------------------
// RecordLinker
// ---------------------------------------------------------------------------

interface Item { id: string; name: string }

function renderRecordLinker(props: Partial<Parameters<typeof RecordLinker<Item, Item>>[0]> = {}) {
  return wrap(
    <RecordLinker<Item, Item>
      organizationId="org-1"
      title="Linked Items"
      addLabel="Add Item"
      isEditing
      linkedItems={[{ id: '1', name: 'Item A' }, { id: '2', name: 'Item B' }]}
      getItemId={(it) => it.id}
      getItemHref={(it) => `/items/${it.id}`}
      renderItem={(it) => <span>{it.name}</span>}
      onLink={vi.fn().mockResolvedValue(undefined)}
      onUnlink={vi.fn().mockResolvedValue(undefined)}
      search={{
        title: 'Find an item',
        searchLabel: 'Search items',
        placeholder: 'Type a name...',
        queryKey: ['items'],
        searchFn: async () => [{ id: '3', name: 'Item C' }, { id: '4', name: 'Item D' }],
        getSearchItemId: (it) => it.id,
        getSearchItemLabel: (it) => it.name,
        renderSearchItem: (it) => <span>{it.name}</span>,
      }}
      create={{
        label: 'Create New Item',
        renderCreateFields: ({ formData, setFormData }) => (
          <div>
            <label htmlFor="new-item-name">Name</label>
            <input
              id="new-item-name"
              value={formData.name ?? ''}
              onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))}
            />
          </div>
        ),
        onCreateSubmit: vi.fn().mockResolvedValue(undefined),
      }}
      {...props}
    />,
  );
}

describe('RecordLinker a11y', () => {
  it('has no axe violations and names each row action after its item', async () => {
    const { container } = renderRecordLinker();
    await expectNoViolations(container);

    const list = screen.getByRole('list', { name: 'Linked Items' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    // Fallback naming: action + rendered item content
    expect(screen.getByRole('button', { name: 'Unlink Item A' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View record Item B' })).toHaveAttribute('href', '/items/2');
  });

  it('uses getItemLabel for action names when provided', () => {
    renderRecordLinker({ getItemLabel: (it) => `the ${it.name} record` });
    expect(screen.getByRole('button', { name: 'Unlink the Item A record' })).toBeInTheDocument();
  });

  it('search slide-over: labelled search, toggle results, focus follows the view', async () => {
    renderRecordLinker();
    fireEvent.click(screen.getByRole('button', { name: 'Add Item' }));

    const dialog = await screen.findByRole('dialog', { name: 'Find an item' });
    const search = within(dialog).getByRole('searchbox', { name: 'Search items' });
    fireEvent.change(search, { target: { value: 'Item' } });

    const result = await within(dialog).findByRole('button', { name: 'Item C' });
    expect(result).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(result);
    expect(result).toHaveAttribute('aria-pressed', 'true');
    await expectNoViolations(document.body);

    // Switching to create moves focus to the first create field...
    fireEvent.click(within(dialog).getByRole('button', { name: /create new item/i }));
    await waitFor(() => expect(within(dialog).getByLabelText('Name')).toHaveFocus());
    await expectNoViolations(document.body);

    // ...and going back returns it to the search input.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Back to search' }));
    await waitFor(() => expect(within(dialog).getByRole('searchbox', { name: 'Search items' })).toHaveFocus());
  });
});

// ---------------------------------------------------------------------------
// Location picker
// ---------------------------------------------------------------------------

describe('LocationPickerModal a11y', () => {
  it('renders the hierarchy as nested lists with disclosure and select buttons', async () => {
    const onSelect = vi.fn();
    wrap(
      <LocationPickerModal isOpen onClose={vi.fn()} onSelect={onSelect} organizationId="org-1" selectedLocationId="loc-2" />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Select Location' });
    expect(within(dialog).getByRole('searchbox', { name: 'Search locations' })).toBeInTheDocument();

    // Selected location's ancestors are expanded on open
    const toggle = await within(dialog).findByRole('button', { name: 'Collapse Main Building' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const selected = within(dialog).getByRole('button', { name: /Gallery A/ });
    expect(selected).toHaveAttribute('aria-current', 'true');
    await expectNoViolations(document.body);

    fireEvent.click(toggle);
    expect(within(dialog).getByRole('button', { name: 'Expand Main Building' })).toHaveAttribute('aria-expanded', 'false');
    expect(within(dialog).queryByRole('button', { name: /Gallery A/ })).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: /^Main Building/ }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ location_id: 'loc-1' }));
  });
});

describe('LocationPickerButton a11y', () => {
  it('is a single labelled button plus a named clear button', async () => {
    const onChange = vi.fn();
    const { container } = wrap(
      <>
        <label id="dest-label" htmlFor="dest">Destination</label>
        <LocationPickerButton id="dest" labelId="dest-label" organizationId="org-1" value="loc-2" onChange={onChange} />
      </>,
    );
    const trigger = await screen.findByRole('button', { name: 'Destination Main Building > Gallery A Display' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    await expectNoViolations(container);

    fireEvent.click(screen.getByRole('button', { name: 'Clear location Main Building > Gallery A' }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('EditableLocationPicker names its trigger with the field label', async () => {
    const { container } = wrap(
      <EditableLocationPicker label="To Location" organizationId="org-1" value={null} onChange={vi.fn()} isEditing required />,
    );
    const trigger = screen.getByRole('button', { name: /^To Location \(required\) Select location/ });
    fireEvent.click(trigger);
    expect(await screen.findByRole('dialog', { name: 'Select Location' })).toBeInTheDocument();
    await expectNoViolations(container);
  });
});

// ---------------------------------------------------------------------------
// Linkers built on RecordLinker
// ---------------------------------------------------------------------------

describe('ConstituentLinker a11y', () => {
  it('has no axe violations in edit mode, including the create form', async () => {
    getObjectConstituentsMock.mockResolvedValue([
      { xref_id: 'x-1', constituent_id: 'c-1', role: 'creator', constituent: { name: 'Jane Smith', constituent_type: 'person', ulan_id: '500', is_verified: true } },
    ]);
    const { container } = wrap(<ConstituentLinker organizationId="org-1" objectId="obj-1" isEditing />);

    expect(await screen.findByRole('button', { name: 'Unlink Jane Smith' })).toBeInTheDocument();
    await expectNoViolations(container);

    fireEvent.click(screen.getByRole('button', { name: 'Add Person or Organization' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('searchbox'), { target: { value: 'Nobody' } });
    fireEvent.click(await within(dialog).findByRole('button', { name: /Create New Person or Organization/ }));

    const typeGroup = within(dialog).getByRole('group', { name: /Type/ });
    expect(within(typeGroup).getAllByRole('radio')).toHaveLength(2);
    await waitFor(() => expect(within(dialog).getByRole('textbox', { name: /Name/ })).toHaveFocus());
    expect(within(dialog).getByRole('combobox', { name: /Role/ })).toBeInTheDocument();
    await expectNoViolations(document.body);
  });
});

describe('SubjectLinker a11y', () => {
  it('has no axe violations in edit mode and names its row actions', async () => {
    getObjectSubjectsMock.mockResolvedValue([
      { link_id: 'l-1', subject_authority_id: 's-1', subject_authority: { preferred_term: 'Landscapes', subject_type: 'iconographic' } },
    ]);
    const { container } = wrap(<SubjectLinker organizationId="org-1" objectId="obj-1" isEditing />);
    expect(await screen.findByRole('button', { name: 'Unlink Landscapes' })).toBeInTheDocument();
    await expectNoViolations(container);
  });
});

// ---------------------------------------------------------------------------
// Row actions menu
// ---------------------------------------------------------------------------

describe('RowActionsMenu a11y', () => {
  it('follows the menu button pattern', async () => {
    const onEdit = vi.fn();
    const { container } = render(
      <RowActionsMenu
        targetLabel="Part 2"
        actions={[
          { label: 'Edit', icon: Edit2, onSelect: onEdit },
          { label: 'Remove', icon: Trash2, onSelect: vi.fn(), destructive: true },
        ]}
      />,
    );
    const trigger = screen.getByRole('button', { name: 'Actions for Part 2' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const menu = screen.getByRole('menu', { name: 'Actions for Part 2' });
    const [edit, remove] = within(menu).getAllByRole('menuitem');
    await waitFor(() => expect(edit).toHaveFocus());
    await expectNoViolations(container);

    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(remove).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(edit).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'End' });
    expect(remove).toHaveFocus();

    act(() => {
      fireEvent.keyDown(menu, { key: 'Escape' });
    });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Edit' }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
