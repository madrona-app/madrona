import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createWorkspaceStubs } from './_workspaceStubs';

// Stub workspace primitives
vi.mock('../../../components/workspace', () => createWorkspaceStubs());

// Stub completion badge
vi.mock('../../../components/collections/SectionCompletionBadge', () => ({
  SectionCompletionBadge: ({
    completion,
  }: {
    completion: { percentage: number };
  }) => <span data-testid="completion-badge">{completion.percentage}%</span>,
}));

// Track selector instances so tests can drive open/close + selection without
// relying on real React state inside the mock factory.
const selectorState = vi.hoisted(() => ({
  openCount: 0,
  lastSelector: null as null | {
    open: () => void;
    close: () => void;
    select: (id: string) => void;
  },
}));

// Stub contact selector slide-over. We render it whenever `isOpen` is truthy
// and expose a button that fires `onSelect` so we can simulate picking a
// contact.
vi.mock('../../../components/collections/ConstituentSelectorSlideOver', () => ({
  ContactSelectorSlideOver: (props: {
    isOpen: boolean;
    title: string;
    onSelect: (id: string) => void;
  }) =>
    props.isOpen ? (
      <div data-testid={`slide-over-${props.title}`}>
        <button
          onClick={() => props.onSelect('contact-selected')}
          data-testid={`select-${props.title}`}
        >
          Pick {props.title}
        </button>
      </div>
    ) : null,
}));

// Mock the contact API
const apiMocks = vi.hoisted(() => ({
  getContact: vi.fn(),
}));
vi.mock('../../../lib/api', () => apiMocks);

// useContactSelector — keep stateful open/close so the slide-over is
// actually rendered when we click the selector trigger button.
vi.mock('../../../hooks/useContactSelector', async () => {
  const reactModule = await import('react');
  return {
    useContactSelector: () => {
      const [isOpen, setIsOpen] = reactModule.useState(false);
      const api = {
        isOpen,
        open: () => {
          selectorState.openCount += 1;
          setIsOpen(true);
        },
        close: () => setIsOpen(false),
        createSelectHandler: (cb: (id: string) => void) => (id: string) => {
          cb(id);
          setIsOpen(false);
        },
      };
      selectorState.lastSelector = {
        open: api.open,
        close: api.close,
        select: () => {},
      };
      return api;
    },
  };
});

import { DepositorSection } from '../../../pages/collections/ObjectEntryWorkspacePage/DepositorSection';
import type { EntryFormData } from '../../../pages/collections/ObjectEntryWorkspacePage/types';

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
}

function renderSection(
  props: Partial<Parameters<typeof DepositorSection>[0]> = {},
  qc: QueryClient = makeQueryClient(),
) {
  const merged: Parameters<typeof DepositorSection>[0] = {
    formData: {
      depositor_id: '',
      depositor_name: '',
      current_owner_id: '',
      current_owner: '',
    } as unknown as EntryFormData,
    updateField: vi.fn(),
    isExpanded: true,
    onToggle: vi.fn(),
    isEditing: false,
    isCreateMode: false,
    getSectionOrder: () => 0,
    sectionCompletion: undefined,
    orgId: 'org-1',
    isRestricted: () => false,
    ...props,
  };
  return render(
    <QueryClientProvider client={qc}>
      <DepositorSection {...merged} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiMocks.getContact.mockReset();
  selectorState.openCount = 0;
});

describe('DepositorSection', () => {
  it('renders the Depositor Information title', () => {
    renderSection();
    expect(
      screen.getByRole('button', { name: 'Depositor Information' }),
    ).toBeInTheDocument();
  });

  it('shows "Not specified" placeholder when depositor is unset (view mode)', () => {
    renderSection();
    expect(screen.getByText('Not specified')).toBeInTheDocument();
  });

  it('shows "Same as depositor" placeholder when current owner is unset (view mode)', () => {
    renderSection();
    expect(screen.getByText('Same as depositor')).toBeInTheDocument();
  });

  it('shows "Search or create depositor..." button in edit mode when no depositor', () => {
    renderSection({ isEditing: true });
    expect(
      screen.getByRole('button', { name: /Search or create depositor/i }),
    ).toBeInTheDocument();
  });

  it('opens depositor selector slide-over when search button clicked', async () => {
    renderSection({ isEditing: true });
    fireEvent.click(
      screen.getByRole('button', { name: /Search or create depositor/i }),
    );
    await waitFor(() => {
      expect(screen.getByTestId('slide-over-Select Depositor')).toBeInTheDocument();
    });
    expect(selectorState.openCount).toBeGreaterThanOrEqual(1);
  });

  it('selecting a depositor calls updateField with the new id', async () => {
    const updateField = vi.fn();
    renderSection({ isEditing: true, updateField });
    fireEvent.click(
      screen.getByRole('button', { name: /Search or create depositor/i }),
    );
    fireEvent.click(await screen.findByTestId('select-Select Depositor'));
    expect(updateField).toHaveBeenCalledWith('depositor_id', 'contact-selected');
  });

  it('renders the depositor contact card when contact loads', async () => {
    apiMocks.getContact.mockImplementation((_org: string, id: string) =>
      Promise.resolve({
        contact_id: id,
        name: 'Jane Lender',
        organization_name: 'Madrona LLC',
      }),
    );

    // Empty depositor_name so the fallback view-mode path doesn't paint
    // "Jane Lender" before the contact query resolves — that lets us prove
    // the component is reading from the contact query.
    const formData = {
      depositor_id: 'c-1',
      depositor_name: '',
      current_owner_id: '',
      current_owner: '',
    } as unknown as EntryFormData;

    renderSection({ isEditing: false, formData });

    await waitFor(
      () => {
        expect(screen.getByText('(Madrona LLC)')).toBeInTheDocument();
      },
      { timeout: 2000 },
    );
    expect(screen.getByText('Jane Lender')).toBeInTheDocument();
    expect(apiMocks.getContact).toHaveBeenCalledWith('org-1', 'c-1');
  });

  it('falls back to formData.depositor_name when contact query has no result', async () => {
    apiMocks.getContact.mockResolvedValue(null);

    const formData = {
      depositor_id: 'c-1',
      depositor_name: 'Fallback Name',
      current_owner_id: '',
      current_owner: '',
    } as unknown as EntryFormData;

    renderSection({ isEditing: false, formData });

    await waitFor(() => {
      expect(screen.getByText('Fallback Name')).toBeInTheDocument();
    });
  });

  it('clears the depositor when X button is clicked in edit mode', async () => {
    apiMocks.getContact.mockResolvedValue({
      contact_id: 'c-1',
      name: 'Jane',
      organization_name: null,
    });
    const updateField = vi.fn();
    const formData = {
      depositor_id: 'c-1',
      depositor_name: 'Jane',
      current_owner_id: '',
      current_owner: '',
    } as unknown as EntryFormData;

    const { container } = renderSection({
      isEditing: true,
      formData,
      updateField,
    });

    await waitFor(() => {
      expect(screen.getByText('Jane')).toBeInTheDocument();
    });

    const clearBtn = container.querySelector('button.ml-auto') as HTMLButtonElement;
    expect(clearBtn).toBeTruthy();
    fireEvent.click(clearBtn);

    expect(updateField).toHaveBeenCalledWith('depositor_id', '');
    expect(updateField).toHaveBeenCalledWith('depositor_name', '');
  });

  it('renders a completion badge when not in create mode', () => {
    renderSection({
      sectionCompletion: {
        sectionId: 'depositor',
        title: 'Depositor Information',
        completedCount: 1,
        totalCount: 2,
        requiredComplete: true,
        percentage: 50,
        missingRequired: [],
        missingOptional: [],
      },
    });
    expect(screen.getByTestId('completion-badge')).toHaveTextContent('50%');
  });

  it('hides the completion badge in create mode', () => {
    renderSection({
      isCreateMode: true,
      sectionCompletion: {
        sectionId: 'depositor',
        title: 'Depositor Information',
        completedCount: 1,
        totalCount: 2,
        requiredComplete: true,
        percentage: 50,
        missingRequired: [],
        missingOptional: [],
      },
    });
    expect(screen.queryByTestId('completion-badge')).not.toBeInTheDocument();
  });
});
