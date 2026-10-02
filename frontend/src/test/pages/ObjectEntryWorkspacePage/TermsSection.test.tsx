import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { createWorkspaceStubs } from './_workspaceStubs';

vi.mock('../../../components/workspace', () => createWorkspaceStubs());

vi.mock('../../../components/collections/SectionCompletionBadge', () => ({
  SectionCompletionBadge: ({
    completion,
  }: {
    completion: { percentage: number };
  }) => <span data-testid="completion-badge">{completion.percentage}%</span>,
}));

// Stub TermsAcceptancePanel — we own a thin field-mapping wrapper.
const panelProps: Array<Record<string, unknown>> = [];
vi.mock('../../../components/collections/TermsAcceptancePanel', () => ({
  TermsAcceptancePanel: (props: {
    data: {
      termsAccepted: boolean;
      acceptedDate: string;
      acceptanceMethod: string;
      acceptanceNote: string;
    };
    onChange: (updates: Record<string, unknown>) => void;
    onGenerateReceipt?: () => void;
    isGeneratingReceipt?: boolean;
  }) => {
    panelProps.push(props as unknown as Record<string, unknown>);
    return (
      <div data-testid="terms-panel">
        <div data-testid="terms-accepted">{String(props.data.termsAccepted)}</div>
        <div data-testid="terms-date">{props.data.acceptedDate}</div>
        <div data-testid="terms-method">{props.data.acceptanceMethod}</div>
        <button
          data-testid="toggle-accepted"
          onClick={() => props.onChange({ termsAccepted: true })}
        >
          accept
        </button>
        <button
          data-testid="set-date"
          onClick={() => props.onChange({ acceptedDate: '2024-09-01' })}
        >
          set date
        </button>
        <button
          data-testid="set-by"
          onClick={() => props.onChange({ acceptedById: 'user-9' })}
        >
          set by
        </button>
        <button
          data-testid="set-method"
          onClick={() => props.onChange({ acceptanceMethod: 'verbal' })}
        >
          set method
        </button>
        <button
          data-testid="set-note"
          onClick={() => props.onChange({ acceptanceNote: 'Verbally agreed' })}
        >
          set note
        </button>
        {props.onGenerateReceipt && (
          <button
            data-testid="receipt-from-panel"
            onClick={props.onGenerateReceipt}
          >
            receipt
          </button>
        )}
        <div data-testid="generating">{String(props.isGeneratingReceipt)}</div>
      </div>
    );
  },
}));

vi.mock('../../../components/collections/SignedDocumentSlot', () => ({
  SignedDocumentSlot: (props: {
    procedureType: string;
    procedureId: string;
    title: string;
    onGenerateUnsigned?: () => void;
  }) => (
    <div
      data-testid="signed-doc-slot"
      data-type={props.procedureType}
      data-id={props.procedureId}
    >
      {props.title}
      {props.onGenerateUnsigned && (
        <button
          data-testid="signed-doc-generate"
          onClick={props.onGenerateUnsigned}
        >
          gen
        </button>
      )}
    </div>
  ),
}));

import { TermsSection } from '../../../pages/collections/ObjectEntryWorkspacePage/TermsSection';
import type { EntryFormData } from '../../../pages/collections/ObjectEntryWorkspacePage/types';

const FORM_BASE = {
  terms_accepted: true,
  terms_accepted_date: '2024-04-04',
  terms_accepted_by_id: 'u-1',
  acceptance_method: 'signature',
  acceptance_note: 'Signed in person',
} as unknown as EntryFormData;

function renderSection(props: Partial<Parameters<typeof TermsSection>[0]> = {}) {
  const merged: Parameters<typeof TermsSection>[0] = {
    formData: FORM_BASE,
    updateField: vi.fn(),
    isExpanded: true,
    onToggle: vi.fn(),
    isEditing: false,
    isCreateMode: false,
    getSectionOrder: () => 0,
    sectionCompletion: undefined,
    orgId: 'org-1',
    entryId: 'entry-1',
    onGenerateReceipt: vi.fn(),
    isGeneratingReceipt: false,
    ...props,
  };
  return render(<TermsSection {...merged} />);
}

describe('TermsSection', () => {
  it('renders the Terms & Conditions title', () => {
    renderSection();
    expect(
      screen.getByRole('button', { name: 'Terms & Conditions' }),
    ).toBeInTheDocument();
  });

  it('forwards formData state into the TermsAcceptancePanel', () => {
    renderSection();
    expect(screen.getByTestId('terms-accepted')).toHaveTextContent('true');
    expect(screen.getByTestId('terms-date')).toHaveTextContent('2024-04-04');
    expect(screen.getByTestId('terms-method')).toHaveTextContent('signature');
  });

  it('maps termsAccepted change to terms_accepted via updateField', () => {
    const updateField = vi.fn();
    renderSection({ updateField });
    fireEvent.click(screen.getByTestId('toggle-accepted'));
    expect(updateField).toHaveBeenCalledWith('terms_accepted', true);
  });

  it('maps acceptedDate change to terms_accepted_date', () => {
    const updateField = vi.fn();
    renderSection({ updateField });
    fireEvent.click(screen.getByTestId('set-date'));
    expect(updateField).toHaveBeenCalledWith(
      'terms_accepted_date',
      '2024-09-01',
    );
  });

  it('maps acceptedById change to terms_accepted_by_id', () => {
    const updateField = vi.fn();
    renderSection({ updateField });
    fireEvent.click(screen.getByTestId('set-by'));
    expect(updateField).toHaveBeenCalledWith('terms_accepted_by_id', 'user-9');
  });

  it('maps acceptanceMethod change to acceptance_method', () => {
    const updateField = vi.fn();
    renderSection({ updateField });
    fireEvent.click(screen.getByTestId('set-method'));
    expect(updateField).toHaveBeenCalledWith('acceptance_method', 'verbal');
  });

  it('maps acceptanceNote change to acceptance_note', () => {
    const updateField = vi.fn();
    renderSection({ updateField });
    fireEvent.click(screen.getByTestId('set-note'));
    expect(updateField).toHaveBeenCalledWith(
      'acceptance_note',
      'Verbally agreed',
    );
  });

  it('renders the SignedDocumentSlot for the entry when not in create mode', () => {
    renderSection();
    const slot = screen.getByTestId('signed-doc-slot');
    expect(slot).toHaveAttribute('data-type', 'object_entry');
    expect(slot).toHaveAttribute('data-id', 'entry-1');
  });

  it('hides the SignedDocumentSlot in create mode', () => {
    renderSection({ isCreateMode: true, entryId: undefined });
    expect(screen.queryByTestId('signed-doc-slot')).not.toBeInTheDocument();
  });

  it('passes the receipt generation handler through to the panel', () => {
    const onGenerateReceipt = vi.fn();
    renderSection({ onGenerateReceipt });
    fireEvent.click(screen.getByTestId('receipt-from-panel'));
    expect(onGenerateReceipt).toHaveBeenCalledTimes(1);
  });

  it('passes the receipt generation handler through to SignedDocumentSlot', () => {
    const onGenerateReceipt = vi.fn();
    renderSection({ onGenerateReceipt });
    fireEvent.click(screen.getByTestId('signed-doc-generate'));
    expect(onGenerateReceipt).toHaveBeenCalledTimes(1);
  });

  it('reflects isGeneratingReceipt into the panel', () => {
    renderSection({ isGeneratingReceipt: true });
    expect(screen.getByTestId('generating')).toHaveTextContent('true');
  });

  it('shows completion badge outside create mode', () => {
    renderSection({
      sectionCompletion: {
        sectionId: 'terms-acceptance',
        title: 'Terms',
        completedCount: 4,
        totalCount: 5,
        requiredComplete: true,
        percentage: 80,
        missingRequired: [],
        missingOptional: [],
      },
    });
    expect(screen.getByTestId('completion-badge')).toHaveTextContent('80%');
  });
});
