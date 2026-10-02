import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Stub workspace primitives so we can drive props directly.
vi.mock('../../../components/workspace', () => ({
  WorkspaceSection: ({
    title,
    children,
    onToggle,
    isExpanded,
    badge,
  }: {
    title: string;
    children: React.ReactNode;
    onToggle: () => void;
    isExpanded: boolean;
    badge?: React.ReactNode;
  }) => (
    <section data-testid="ws-section">
      <button onClick={onToggle}>{title}</button>
      {badge && <div data-testid="ws-badge">{badge}</div>}
      {isExpanded && <div>{children}</div>}
    </section>
  ),
  EditableField: ({
    label,
    value,
    isEditing,
    onChange,
    type,
    required,
  }: {
    label: string;
    value: string;
    isEditing: boolean;
    onChange: (v: string) => void;
    type?: string;
    required?: boolean;
  }) => (
    <label data-testid={`ef-${label}`}>
      <span>
        {label}
        {required && '*'}
      </span>
      {isEditing ? (
        <input
          aria-label={label}
          type={type === 'date' ? 'date' : 'text'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <span data-testid={`view-${label}`}>{value}</span>
      )}
    </label>
  ),
  EditableSelect: ({
    label,
    value,
    isEditing,
    onChange,
    options,
    required,
  }: {
    label: string;
    value: string;
    isEditing: boolean;
    onChange: (v: string) => void;
    options: Array<{ value: string; label: string }>;
    required?: boolean;
  }) =>
    isEditing ? (
      <label data-testid={`es-${label}`}>
        <span>
          {label}
          {required && '*'}
        </span>
        <select
          aria-label={label}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    ) : (
      <div data-testid={`es-view-${label}`}>
        {options.find((o) => o.value === value)?.label ?? value}
      </div>
    ),
}));

// SectionCompletionBadge stub
vi.mock('../../../components/collections/SectionCompletionBadge', () => ({
  SectionCompletionBadge: ({
    completion,
  }: {
    completion: { percentage: number };
  }) => <span data-testid="completion-badge">{completion.percentage}%</span>,
}));

import { EntryInfoSection } from '../../../pages/collections/ObjectEntryWorkspacePage/EntryInfoSection';
import type { EntryFormData } from '../../../pages/collections/ObjectEntryWorkspacePage/types';

const FORM_DATA = {
  entry_date: '2024-04-01',
  reason: 'loan_consideration',
  receipt_reference: 'R-77',
  entry_method: 'hand_delivery',
} as unknown as EntryFormData;

const REASON_OPTIONS = [
  { value: '', label: '— Select reason —' },
  { value: 'loan_consideration', label: 'Loan consideration' },
  { value: 'gift_offer', label: 'Gift offer' },
];

function renderInfo(props: Partial<Parameters<typeof EntryInfoSection>[0]> = {}) {
  return render(
    <EntryInfoSection
      formData={FORM_DATA}
      updateField={vi.fn()}
      isExpanded
      onToggle={vi.fn()}
      isEditing={false}
      isCreateMode={false}
      getSectionOrder={() => 0}
      sectionCompletion={undefined}
      entryReasonOptions={REASON_OPTIONS}
      orgId="org-1"
      {...props}
    />,
  );
}

describe('EntryInfoSection', () => {
  it('renders the Entry Information title', () => {
    renderInfo();
    expect(
      screen.getByRole('button', { name: 'Entry Information' }),
    ).toBeInTheDocument();
  });

  it('renders all four core fields when expanded', () => {
    renderInfo({ isEditing: true });
    expect(screen.getByLabelText('Entry Date')).toBeInTheDocument();
    expect(screen.getByLabelText('Reason for Entry')).toBeInTheDocument();
    expect(screen.getByLabelText('Receipt Reference')).toBeInTheDocument();
    expect(screen.getByLabelText('Entry Method')).toBeInTheDocument();
  });

  it('hides the completion badge in create mode', () => {
    renderInfo({
      isCreateMode: true,
      sectionCompletion: {
        sectionId: 'entry',
        title: 'Entry Information',
        completedCount: 2,
        totalCount: 3,
        requiredComplete: false,
        percentage: 66,
        missingRequired: [],
        missingOptional: [],
      },
    });
    expect(screen.queryByTestId('completion-badge')).not.toBeInTheDocument();
  });

  it('shows the completion badge when not in create mode', () => {
    renderInfo({
      sectionCompletion: {
        sectionId: 'entry',
        title: 'Entry Information',
        completedCount: 3,
        totalCount: 3,
        requiredComplete: true,
        percentage: 100,
        missingRequired: [],
        missingOptional: [],
      },
    });
    expect(screen.getByTestId('completion-badge')).toHaveTextContent('100%');
  });

  it('forwards entry_date input changes through updateField', () => {
    const updateField = vi.fn();
    renderInfo({ isEditing: true, updateField });
    fireEvent.change(screen.getByLabelText('Entry Date'), {
      target: { value: '2024-12-25' },
    });
    expect(updateField).toHaveBeenCalledWith('entry_date', '2024-12-25');
  });

  it('forwards reason select changes through updateField', () => {
    const updateField = vi.fn();
    renderInfo({ isEditing: true, updateField });
    fireEvent.change(screen.getByLabelText('Reason for Entry'), {
      target: { value: 'gift_offer' },
    });
    expect(updateField).toHaveBeenCalledWith('reason', 'gift_offer');
  });

  it('forwards receipt_reference text changes', () => {
    const updateField = vi.fn();
    renderInfo({ isEditing: true, updateField });
    fireEvent.change(screen.getByLabelText('Receipt Reference'), {
      target: { value: 'R-99' },
    });
    expect(updateField).toHaveBeenCalledWith('receipt_reference', 'R-99');
  });

  it('forwards entry_method select changes', () => {
    const updateField = vi.fn();
    renderInfo({ isEditing: true, updateField });
    fireEvent.change(screen.getByLabelText('Entry Method'), {
      target: { value: 'courier' },
    });
    expect(updateField).toHaveBeenCalledWith('entry_method', 'courier');
  });

  it('marks Entry Date and Reason as required', () => {
    renderInfo({ isEditing: true });
    expect(screen.getByText(/Entry Date\*/)).toBeInTheDocument();
    expect(screen.getByText(/Reason for Entry\*/)).toBeInTheDocument();
  });

  it('toggle button fires onToggle', () => {
    const onToggle = vi.fn();
    renderInfo({ onToggle });
    fireEvent.click(screen.getByRole('button', { name: 'Entry Information' }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
