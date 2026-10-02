import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createWorkspaceStubs } from './_workspaceStubs';

vi.mock('../../../components/workspace', () => createWorkspaceStubs());

// Stub the three linker components so we can detect which is rendered.
vi.mock('../../../components/collections/EntryAcquisitionLinker', () => ({
  EntryAcquisitionLinker: (props: { linkedAcquisition?: { acquisition_id?: string } }) => (
    <div data-testid="acquisition-linker">
      Acquisition: {props.linkedAcquisition?.acquisition_id || 'none'}
    </div>
  ),
}));
vi.mock('../../../components/collections/EntryLoanLinker', () => ({
  EntryLoanLinker: (props: { linkedLoan?: { loan_in_id?: string } }) => (
    <div data-testid="loan-linker">
      Loan: {props.linkedLoan?.loan_in_id || 'none'}
    </div>
  ),
}));
vi.mock('../../../components/collections/EntryExitLinker', () => ({
  EntryExitLinker: (props: {
    linkedExit?: { exit_id?: string };
    onLinkChange: () => void;
  }) => (
    <div data-testid="exit-linker">
      Exit: {props.linkedExit?.exit_id || 'none'}
      <button data-testid="exit-link-change" onClick={props.onLinkChange}>
        link change
      </button>
    </div>
  ),
}));

// Stub SlideOver so we can interact with it
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

// API mock
const apiMocks = vi.hoisted(() => ({
  markObjectEntryReturned: vi.fn(),
}));
vi.mock('../../../lib/api', () => apiMocks);

import { LinkedRecordsSection } from '../../../pages/collections/ObjectEntryWorkspacePage/LinkedRecordsSection';

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderLinked(
  props: Partial<Parameters<typeof LinkedRecordsSection>[0]> = {},
) {
  const merged: Parameters<typeof LinkedRecordsSection>[0] = {
    orgId: 'org-1',
    entryId: 'entry-1',
    effectiveReason: '',
    expandedSections: { acquisition: true, 'loan-in': true, exit: true },
    onToggle: vi.fn(),
    isEditing: false,
    isCreateMode: false,
    getSectionOrder: () => 0,
    onLinkChange: vi.fn(),
    ...props,
  };
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <LinkedRecordsSection {...merged} />
    </QueryClientProvider>,
  );
}

describe('LinkedRecordsSection', () => {
  it('always renders the Exit linker (procedure universal return path)', () => {
    renderLinked({ effectiveReason: 'enquiry' });
    expect(screen.getByTestId('exit-linker')).toBeInTheDocument();
  });

  it('hides Acquisition + Loan linkers for enquiry reason', () => {
    renderLinked({ effectiveReason: 'enquiry' });
    expect(screen.queryByTestId('acquisition-linker')).not.toBeInTheDocument();
    expect(screen.queryByTestId('loan-linker')).not.toBeInTheDocument();
  });

  it('shows Acquisition linker when reason is gift_offer', () => {
    renderLinked({ effectiveReason: 'gift_offer' });
    expect(screen.getByTestId('acquisition-linker')).toBeInTheDocument();
    expect(screen.queryByTestId('loan-linker')).not.toBeInTheDocument();
  });

  it('shows Acquisition linker when reason is purchase_consideration', () => {
    renderLinked({ effectiveReason: 'purchase_consideration' });
    expect(screen.getByTestId('acquisition-linker')).toBeInTheDocument();
  });

  it('shows Loan linker when reason is loan_consideration', () => {
    renderLinked({ effectiveReason: 'loan_consideration' });
    expect(screen.getByTestId('loan-linker')).toBeInTheDocument();
    expect(screen.queryByTestId('acquisition-linker')).not.toBeInTheDocument();
  });

  it('keeps Acquisition linker visible if a linkedAcquisition exists, even with non-acquisition reason', () => {
    renderLinked({
      effectiveReason: 'enquiry',
      linkedAcquisition: { acquisition_id: 'a-1' },
    });
    expect(screen.getByTestId('acquisition-linker')).toHaveTextContent('a-1');
  });

  it('keeps Loan linker visible if a linkedLoan exists, even with non-loan reason', () => {
    renderLinked({
      effectiveReason: 'enquiry',
      linkedLoan: { loan_in_id: 'l-1', loan_in_entry_id: 'e-1' } as React.ComponentProps<typeof LinkedRecordsSection>['linkedLoan'],
    });
    expect(screen.getByTestId('loan-linker')).toHaveTextContent('l-1');
  });

  it('shows the linked exit id', () => {
    renderLinked({
      effectiveReason: 'enquiry',
      linkedExit: { exit_id: 'x-1' },
    });
    expect(screen.getByTestId('exit-linker')).toHaveTextContent('x-1');
  });

  it('forwards onLinkChange from the exit linker', () => {
    const onLinkChange = vi.fn();
    renderLinked({ effectiveReason: 'enquiry', onLinkChange });
    fireEvent.click(screen.getByTestId('exit-link-change'));
    expect(onLinkChange).toHaveBeenCalledTimes(1);
  });

  it('does not render unrelated linkers without an existing link', () => {
    renderLinked({ effectiveReason: 'identification' });
    // exit always rendered
    expect(screen.getByTestId('exit-linker')).toBeInTheDocument();
    // acquisition + loan absent
    expect(screen.queryByTestId('acquisition-linker')).not.toBeInTheDocument();
    expect(screen.queryByTestId('loan-linker')).not.toBeInTheDocument();
  });
});
