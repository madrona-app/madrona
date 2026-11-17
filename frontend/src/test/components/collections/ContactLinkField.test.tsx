import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { checkA11y } from '../../a11y';
import { ContactLinkField } from '../../../components/collections/ContactLinkField';
import { ObjectRightsManager } from '../../../components/collections/ObjectRightsManager';
import { AddRightsModal } from '../../../components/dam/AddRightsModal';

const { getContactMock, getObjectRightsMock, createObjectRightMock, createMediaRightsMock } = vi.hoisted(() => ({
  getContactMock: vi.fn(),
  getObjectRightsMock: vi.fn(),
  createObjectRightMock: vi.fn(),
  createMediaRightsMock: vi.fn(),
}));

vi.mock('../../../lib/api', () => ({
  getContact: getContactMock,
  getObjectRights: getObjectRightsMock,
  deleteObjectRight: vi.fn(),
  createObjectRight: createObjectRightMock,
  createMediaRights: createMediaRightsMock,
  updateMediaRights: vi.fn(),
}));

// Stand-in picker: one button per contact that selects it, plus Cancel.
vi.mock('../../../components/collections/ConstituentSelectorSlideOver', () => ({
  ContactSelectorSlideOver: ({
    isOpen,
    onSelect,
    onClose,
    title,
  }: {
    isOpen: boolean;
    onSelect: (id: string) => void;
    onClose: () => void;
    title: string;
  }) =>
    isOpen ? (
      <div role="dialog" aria-label={title}>
        <button
          type="button"
          onClick={() => {
            onSelect('c-agent');
            onClose();
          }}
        >
          Choose Artists Rights Agency
        </button>
        <button type="button" onClick={onClose}>
          Cancel picker
        </button>
      </div>
    ) : null,
}));

function wrap(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return (
    <MemoryRouter>
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>
    </MemoryRouter>
  );
}

function Harness({ initial = '' }: { initial?: string }) {
  const [id, setId] = useState(initial);
  return (
    <ContactLinkField
      organizationId="org-1"
      contactId={id}
      onChange={setId}
      label="Agent for rights holder"
      hint="The person or organisation that handles permissions on the rights holder's behalf."
    />
  );
}

describe('ContactLinkField', () => {
  beforeEach(() => {
    getContactMock.mockReset();
    getContactMock.mockResolvedValue({ constituent_id: 'c-agent', name: 'Artists Rights Agency', organization_name: null });
  });

  it('is a labelled group with a named select control and no a11y violations', async () => {
    const { container } = render(wrap(<Harness />));
    const group = screen.getByRole('group', { name: 'Agent for rights holder' });
    expect(group).toHaveAccessibleDescription(/handles permissions/);
    expect(within(group).getByRole('button', { name: 'Select agent for rights holder' })).toBeInTheDocument();
    const results = await checkA11y(container);
    expect(results.violations).toEqual([]);
  });

  it('selecting a contact shows it, announces it, and focuses the remove button', async () => {
    const user = userEvent.setup();
    const { container } = render(wrap(<Harness />));
    await user.click(screen.getByRole('button', { name: 'Select agent for rights holder' }));
    await user.click(screen.getByRole('button', { name: 'Choose Artists Rights Agency' }));

    const remove = await screen.findByRole('button', {
      name: 'Remove agent for rights holder Artists Rights Agency',
    });
    await waitFor(() => expect(remove).toHaveFocus());
    expect(screen.getByRole('status')).toHaveTextContent('Agent for rights holder selected');
    expect(getContactMock).toHaveBeenCalledWith('org-1', 'c-agent');
    const results = await checkA11y(container);
    expect(results.violations).toEqual([]);
  });

  it('removing the contact announces it and returns focus to the select button', async () => {
    const user = userEvent.setup();
    render(wrap(<Harness initial="c-agent" />));
    const remove = await screen.findByRole('button', {
      name: 'Remove agent for rights holder Artists Rights Agency',
    });
    await user.click(remove);
    const select = screen.getByRole('button', { name: 'Select agent for rights holder' });
    await waitFor(() => expect(select).toHaveFocus());
    expect(screen.getByRole('status')).toHaveTextContent('Agent for rights holder Artists Rights Agency removed');
  });

  it('cancelling the picker returns focus to the select button', async () => {
    const user = userEvent.setup();
    render(wrap(<Harness />));
    await user.click(screen.getByRole('button', { name: 'Select agent for rights holder' }));
    await user.click(screen.getByRole('button', { name: 'Cancel picker' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Select agent for rights holder' })).toHaveFocus(),
    );
  });

  it('Escape closes only the picker', async () => {
    const user = userEvent.setup();
    const outerEscape = vi.fn();
    document.addEventListener('keydown', outerEscape);
    render(wrap(<Harness />));
    await user.click(screen.getByRole('button', { name: 'Select agent for rights holder' }));
    expect(screen.getByRole('dialog', { name: 'Select agent for rights holder' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(outerEscape).not.toHaveBeenCalled();
    document.removeEventListener('keydown', outerEscape);
  });

  it('read-only mode shows the name without controls', async () => {
    render(wrap(
      <ContactLinkField organizationId="org-1" contactId="c-agent" onChange={vi.fn()} label="Agent for rights holder" isEditing={false} />,
    ));
    expect(await screen.findByText('Artists Rights Agency')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('Agent for rights holder in rights editors', () => {
  beforeEach(() => {
    getContactMock.mockReset();
    getContactMock.mockResolvedValue({ constituent_id: 'c-agent', name: 'Artists Rights Agency', organization_name: null });
    getObjectRightsMock.mockReset();
    createObjectRightMock.mockReset();
    createMediaRightsMock.mockReset();
  });

  it('object rights list shows the agent and the add form sends it', async () => {
    const user = userEvent.setup();
    getObjectRightsMock.mockResolvedValue([
      {
        right_id: 'r-1', organization_id: 'org-1', object_id: 'obj-1', right_type: 'copyright',
        status: 'licensed', is_perpetual: false, fee_required: false, is_orphan_work: false,
        due_diligence_conducted: false, rights_holder_contact_name: 'Estate of A. Painter',
        rights_holder_agent_contact_name: 'Artists Rights Agency',
      },
    ]);
    createObjectRightMock.mockResolvedValue({ right_id: 'r-2' });
    render(wrap(<ObjectRightsManager organizationId="org-1" objectId="obj-1" />));

    expect(await screen.findByText('Estate of A. Painter')).toBeInTheDocument();
    expect(screen.getByText('Agent for rights holder: Artists Rights Agency')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Add Right$/ }));
    const group = await screen.findByRole('group', { name: 'Agent for rights holder' });
    await user.click(within(group).getByRole('button', { name: 'Select agent for rights holder' }));
    await user.click(screen.getByRole('button', { name: 'Choose Artists Rights Agency' }));
    await screen.findByRole('button', { name: 'Remove agent for rights holder Artists Rights Agency' });

    const dialog = screen.getByRole('dialog', { name: 'Add Right' });
    const results = await checkA11y(dialog);
    expect(results.violations).toEqual([]);

    const addButtons = within(dialog).getAllByRole('button', { name: 'Add Right' });
    await user.click(addButtons[addButtons.length - 1]);
    await waitFor(() => expect(createObjectRightMock).toHaveBeenCalled());
    expect(createObjectRightMock.mock.calls[0][2]).toMatchObject({ rights_holder_agent_contact_id: 'c-agent' });
  });

  it('media rights dialog links an agent contact and a free-text name', async () => {
    const user = userEvent.setup();
    createMediaRightsMock.mockResolvedValue({ rights_id: 'mr-1' });
    const { baseElement } = render(wrap(
      <AddRightsModal isOpen organizationId="org-1" mediaId="m-1" onClose={vi.fn()} />,
    ));
    const group = screen.getByRole('group', { name: 'Agent for rights holder' });
    await user.click(within(group).getByRole('button', { name: 'Select agent for rights holder' }));
    await user.click(screen.getByRole('button', { name: 'Choose Artists Rights Agency' }));
    await screen.findByRole('button', { name: 'Remove agent for rights holder Artists Rights Agency' });
    await user.type(screen.getByLabelText('Agent name (if not a contact record)'), 'London office');

    const results = await checkA11y(baseElement);
    expect(results.violations).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'Add Rights' }));
    await waitFor(() => expect(createMediaRightsMock).toHaveBeenCalled());
    expect(createMediaRightsMock.mock.calls[0][2]).toMatchObject({
      rights_holder_agent_contact_id: 'c-agent',
      rights_holder_agent: 'London office',
    });
  });
});
