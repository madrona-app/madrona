import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createWorkspaceStubs } from './_workspaceStubs';

vi.mock('../../../components/workspace', () => createWorkspaceStubs());

vi.mock('../../../components/collections/SectionCompletionBadge', () => ({
  SectionCompletionBadge: ({
    completion,
  }: {
    completion: { percentage: number };
  }) => <span data-testid="completion-badge">{completion.percentage}%</span>,
}));

// Stub LocationPickerModal
vi.mock('../../../components/collections/LocationPickerModal', () => ({
  LocationPickerModal: (props: {
    isOpen: boolean;
    onSelect: (l: { location_id: string }) => void;
  }) =>
    props.isOpen ? (
      <div data-testid="location-picker">
        <button
          data-testid="pick-location"
          onClick={() => props.onSelect({ location_id: 'loc-1' })}
        >
          pick
        </button>
      </div>
    ) : null,
}));

// Stub SlideOver
vi.mock('../../../components/ui/SlideOver', () => ({
  default: (props: {
    isOpen: boolean;
    title: string;
    children: React.ReactNode;
    footer?: React.ReactNode;
  }) =>
    props.isOpen ? (
      <div data-testid={`slide-over-${props.title}`}>
        {props.children}
        {props.footer}
      </div>
    ) : null,
}));

// Stub ConfirmDialog
vi.mock('../../../components/ConfirmDialog', () => ({
  default: (props: {
    isOpen: boolean;
    title: string;
    onConfirm: () => void;
    onClose: () => void;
  }) =>
    props.isOpen ? (
      <div data-testid={`confirm-${props.title}`}>
        <button data-testid="confirm-yes" onClick={props.onConfirm}>
          yes
        </button>
        <button data-testid="confirm-no" onClick={props.onClose}>
          no
        </button>
      </div>
    ) : null,
}));

// Stub the entries API + condition reports
const apiMocks = vi.hoisted(() => ({
  addObjectEntryItem: vi.fn(),
  updateObjectEntryItem: vi.fn(),
  removeObjectEntryItem: vi.fn(),
  uploadObjectEntryItemMedia: vi.fn(),
  removeObjectEntryItemMedia: vi.fn(),
  setObjectEntryItemPrimaryMedia: vi.fn(),
}));
vi.mock('../../../lib/api/procedure/entries', () => apiMocks);

const collectionsMocks = vi.hoisted(() => ({
  createConditionReport: vi.fn(),
}));
vi.mock('../../../lib/api', () => collectionsMocks);

import { ObjectsSection } from '../../../pages/collections/ObjectEntryWorkspacePage/ObjectsSection';
import type { EntryFormData } from '../../../pages/collections/ObjectEntryWorkspacePage/types';

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderObjects(
  props: Partial<Parameters<typeof ObjectsSection>[0]> = {},
) {
  const merged: Parameters<typeof ObjectsSection>[0] = {
    formData: { objects_description: '' } as unknown as EntryFormData,
    updateField: vi.fn(),
    isExpanded: true,
    onToggle: vi.fn(),
    isEditing: false,
    isCreateMode: false,
    getSectionOrder: () => 0,
    sectionCompletion: undefined,
    orgId: 'org-1',
    entryId: 'entry-1',
    entry: { entry_id: 'entry-1', items: [] },
    hasMediaApp: true,
    ...props,
  };
  return render(
    <MemoryRouter>
      <QueryClientProvider client={makeQueryClient()}>
        <ObjectsSection {...merged} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('ObjectsSection', () => {
  it('renders "Objects" title when there are no items', () => {
    renderObjects();
    expect(screen.getByRole('button', { name: 'Objects' })).toBeInTheDocument();
  });

  it('shows item count in title with singular form', () => {
    renderObjects({
      entry: {
        entry_id: 'entry-1',
        items: [{ entry_item_id: 'i-1', brief_description: 'A' }],
      },
    });
    expect(
      screen.getByRole('button', { name: 'Objects (1 item)' }),
    ).toBeInTheDocument();
  });

  it('shows item count in title with plural form', () => {
    renderObjects({
      entry: {
        entry_id: 'entry-1',
        items: [
          { entry_item_id: 'i-1', brief_description: 'A' },
          { entry_item_id: 'i-2', brief_description: 'B' },
        ],
      },
    });
    expect(
      screen.getByRole('button', { name: 'Objects (2 items)' }),
    ).toBeInTheDocument();
  });

  it('shows "No items added yet" when items list is empty', () => {
    renderObjects();
    expect(screen.getByText('No items added yet')).toBeInTheDocument();
  });

  it('shows "Add First Item" button only in editing+non-create mode', () => {
    renderObjects({ isEditing: true });
    expect(screen.getByText('Add First Item')).toBeInTheDocument();
  });

  it('hides add-item buttons in view mode', () => {
    renderObjects();
    expect(screen.queryByText('Add Item')).not.toBeInTheDocument();
    expect(screen.queryByText('Add First Item')).not.toBeInTheDocument();
  });

  it('hides add-item buttons in create mode', () => {
    renderObjects({ isCreateMode: true, entry: { entry_id: undefined } });
    // Create mode doesn't render the items section at all
    expect(screen.queryByText('Add Item')).not.toBeInTheDocument();
    expect(screen.queryByText('Add First Item')).not.toBeInTheDocument();
  });

  it('opens AddItem slide-over when "Add First Item" is clicked', () => {
    renderObjects({ isEditing: true });
    fireEvent.click(screen.getByText('Add First Item'));
    expect(
      screen.getByTestId('slide-over-Add Entry Item'),
    ).toBeInTheDocument();
  });

  it('forwards summary description changes to updateField', () => {
    const updateField = vi.fn();
    renderObjects({ isEditing: true, updateField });
    fireEvent.change(screen.getByLabelText('Summary Description'), {
      target: { value: 'New summary' },
    });
    expect(updateField).toHaveBeenCalledWith('objects_description', 'New summary');
  });

  it('renders an item row with brief description', () => {
    renderObjects({
      entry: {
        entry_id: 'entry-1',
        items: [
          {
            entry_item_id: 'i-1',
            brief_description: 'Stone tablet',
            item_number: 1,
          },
        ],
      },
    });
    expect(screen.getByText('Stone tablet')).toBeInTheDocument();
  });

  it('shows "No description" placeholder for an empty item', () => {
    renderObjects({
      entry: {
        entry_id: 'entry-1',
        items: [
          { entry_item_id: 'i-1', brief_description: '', item_number: 1 },
        ],
      },
    });
    expect(screen.getByText('No description')).toBeInTheDocument();
  });

  it('renders the depositor object number when present', () => {
    renderObjects({
      entry: {
        entry_id: 'entry-1',
        items: [
          {
            entry_item_id: 'i-1',
            brief_description: 'A',
            lender_object_number: 'LON-99',
            item_number: 1,
          },
        ],
      },
    });
    expect(screen.getByText(/LON-99/)).toBeInTheDocument();
  });

  it('renders the completion badge when not in create mode', () => {
    renderObjects({
      sectionCompletion: {
        sectionId: 'objects',
        title: 'Objects',
        completedCount: 1,
        totalCount: 2,
        requiredComplete: false,
        percentage: 50,
        missingRequired: [],
        missingOptional: [],
      },
    });
    expect(screen.getByTestId('completion-badge')).toHaveTextContent('50%');
  });

  it('shows a delete button on items in editing mode', () => {
    renderObjects({
      isEditing: true,
      entry: {
        entry_id: 'entry-1',
        items: [
          { entry_item_id: 'i-1', brief_description: 'A', item_number: 1 },
        ],
      },
    });
    // The trash icon button has title="Remove item"
    const deleteBtn = screen.getByTitle('Remove item');
    expect(deleteBtn).toBeInTheDocument();
  });

  it('hides delete buttons in view mode', () => {
    renderObjects({
      entry: {
        entry_id: 'entry-1',
        items: [
          { entry_item_id: 'i-1', brief_description: 'A', item_number: 1 },
        ],
      },
    });
    expect(screen.queryByTitle('Remove item')).not.toBeInTheDocument();
  });

  it('clicking delete opens the Remove Item confirm dialog and confirming triggers removeObjectEntryItem', async () => {
    apiMocks.removeObjectEntryItem.mockResolvedValue(undefined);
    renderObjects({
      isEditing: true,
      entry: {
        entry_id: 'entry-1',
        items: [
          { entry_item_id: 'i-1', brief_description: 'A', item_number: 1 },
        ],
      },
    });
    fireEvent.click(screen.getByTitle('Remove item'));
    expect(screen.getByTestId('confirm-Remove Item')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('confirm-yes'));
    // mutate() resolves asynchronously
    await Promise.resolve();
    expect(apiMocks.removeObjectEntryItem).toHaveBeenCalledWith(
      'org-1',
      'entry-1',
      'i-1',
    );
  });
});
