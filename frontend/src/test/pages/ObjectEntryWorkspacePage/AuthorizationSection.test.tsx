import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Stub the shared collections/AuthorizationSection — we own a thin wrapper here.
const sharedSectionProps: Array<Record<string, unknown>> = [];
vi.mock('../../../components/collections/AuthorizationSection', () => ({
  AuthorizationSection: (props: {
    authorizerId: string;
    authorizerContact?: { name: string };
    authorizationDate: string;
    authorizationNote: string;
    onUpdateField: (f: string, v: unknown) => void;
    onOpenAuthorizerSelector: () => void;
    isEditing: boolean;
    isExpanded: boolean;
    onToggle: () => void;
  }) => {
    sharedSectionProps.push(props);
    return (
      <section data-testid="shared-auth-section">
        <button onClick={props.onToggle}>Authorization</button>
        <div data-testid="auth-id">{props.authorizerId}</div>
        <div data-testid="auth-name">{props.authorizerContact?.name ?? '—'}</div>
        <div data-testid="auth-date">{props.authorizationDate}</div>
        <div data-testid="auth-note">{props.authorizationNote}</div>
        <div data-testid="auth-edit">{props.isEditing ? 'edit' : 'view'}</div>
        <button
          data-testid="open-selector"
          onClick={props.onOpenAuthorizerSelector}
        >
          Open Selector
        </button>
        <button
          data-testid="trigger-update"
          onClick={() => props.onUpdateField('authorization_date', '2024-08-01')}
        >
          Update Date
        </button>
      </section>
    );
  },
}));

// Stub the contact slide-over
vi.mock('../../../components/collections/ConstituentSelectorSlideOver', () => ({
  ContactSelectorSlideOver: (props: {
    isOpen: boolean;
    title: string;
    onSelect: (id: string) => void;
  }) =>
    props.isOpen ? (
      <div data-testid={`slide-over-${props.title}`}>
        <button
          data-testid="select-authorizer"
          onClick={() => props.onSelect('authorizer-1')}
        >
          Pick
        </button>
      </div>
    ) : null,
}));

// API mocks
const apiMocks = vi.hoisted(() => ({
  getContact: vi.fn(),
}));
vi.mock('../../../lib/api', () => apiMocks);

// useContactSelector mock with stateful open/close via React useState
vi.mock('../../../hooks/useContactSelector', async () => {
  const reactModule = await import('react');
  return {
    useContactSelector: () => {
      const [isOpen, setIsOpen] = reactModule.useState(false);
      return {
        isOpen,
        open: () => setIsOpen(true),
        close: () => setIsOpen(false),
        createSelectHandler: (cb: (id: string) => void) => (id: string) => {
          cb(id);
          setIsOpen(false);
        },
      };
    },
  };
});

import { AuthorizationSection } from '../../../pages/collections/ObjectEntryWorkspacePage/AuthorizationSection';
import type { EntryFormData } from '../../../pages/collections/ObjectEntryWorkspacePage/types';

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
}

function renderSection(
  props: Partial<Parameters<typeof AuthorizationSection>[0]> = {},
) {
  const merged: Parameters<typeof AuthorizationSection>[0] = {
    formData: {
      authorizer_id: '',
      authorizer_name: '',
      authorization_date: '',
      authorization_note: '',
    } as unknown as EntryFormData,
    updateField: vi.fn(),
    isExpanded: true,
    onToggle: vi.fn(),
    isEditing: false,
    isCreateMode: false,
    getSectionOrder: () => 0,
    orgId: 'org-1',
    ...props,
  };
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <AuthorizationSection {...merged} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiMocks.getContact.mockReset();
  sharedSectionProps.length = 0;
});

describe('AuthorizationSection (entry wrapper)', () => {
  it('forwards formData fields into the shared section', () => {
    renderSection({
      formData: {
        authorizer_id: 'a-1',
        authorizer_name: 'Already Set',
        authorization_date: '2024-04-01',
        authorization_note: 'Note here',
      } as unknown as EntryFormData,
    });

    expect(screen.getByTestId('auth-id')).toHaveTextContent('a-1');
    expect(screen.getByTestId('auth-date')).toHaveTextContent('2024-04-01');
    expect(screen.getByTestId('auth-note')).toHaveTextContent('Note here');
  });

  it('passes the authorizerContact through once getContact resolves', async () => {
    apiMocks.getContact.mockResolvedValue({
      contact_id: 'a-1',
      name: 'Curator Sam',
    });

    renderSection({
      formData: {
        authorizer_id: 'a-1',
        authorizer_name: '',
        authorization_date: '',
        authorization_note: '',
      } as unknown as EntryFormData,
    });

    await waitFor(() => {
      expect(screen.getByTestId('auth-name')).toHaveTextContent('Curator Sam');
    });
    expect(apiMocks.getContact).toHaveBeenCalledWith('org-1', 'a-1');
  });

  it('does not fetch a contact when authorizer_id is empty', () => {
    renderSection();
    expect(apiMocks.getContact).not.toHaveBeenCalled();
  });

  it('flags isEditing through to the shared section', () => {
    renderSection({ isEditing: true });
    expect(screen.getByTestId('auth-edit')).toHaveTextContent('edit');
  });

  it('opening the authorizer selector renders the slide-over', () => {
    renderSection({ isEditing: true });
    fireEvent.click(screen.getByTestId('open-selector'));
    expect(
      screen.getByTestId('slide-over-Select Authorizer'),
    ).toBeInTheDocument();
  });

  it('selecting an authorizer calls updateField with authorizer_id', () => {
    const updateField = vi.fn();
    renderSection({ isEditing: true, updateField });
    fireEvent.click(screen.getByTestId('open-selector'));
    fireEvent.click(screen.getByTestId('select-authorizer'));
    expect(updateField).toHaveBeenCalledWith('authorizer_id', 'authorizer-1');
  });

  it('forwards onUpdateField from the shared section to updateField', () => {
    const updateField = vi.fn();
    renderSection({ isEditing: true, updateField });
    fireEvent.click(screen.getByTestId('trigger-update'));
    expect(updateField).toHaveBeenCalledWith('authorization_date', '2024-08-01');
  });
});
