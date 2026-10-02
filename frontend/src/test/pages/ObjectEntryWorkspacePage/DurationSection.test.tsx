import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { createWorkspaceStubs } from './_workspaceStubs';

vi.mock('../../../components/workspace', () => createWorkspaceStubs());

import { DurationSection } from '../../../pages/collections/ObjectEntryWorkspacePage/DurationSection';
import type { EntryFormData } from '../../../pages/collections/ObjectEntryWorkspacePage/types';

const FORM = {
  expected_duration: '6_months',
  expected_return_date: '2024-12-01',
  conditions: 'Handle with gloves',
} as unknown as EntryFormData;

const DURATION_OPTIONS = [
  { value: '', label: 'Select duration...' },
  { value: '3_months', label: '3 months' },
  { value: '6_months', label: '6 months' },
  { value: '1_year', label: '1 year' },
];

function renderSection(
  props: Partial<Parameters<typeof DurationSection>[0]> = {},
) {
  return render(
    <DurationSection
      formData={FORM}
      updateField={vi.fn()}
      isExpanded
      onToggle={vi.fn()}
      isEditing={false}
      isCreateMode={false}
      getSectionOrder={() => 0}
      durationOptions={DURATION_OPTIONS}
      isRestricted={() => false}
      {...props}
    />,
  );
}

describe('DurationSection', () => {
  it('renders the Expected Duration title', () => {
    renderSection();
    expect(
      screen.getByRole('button', { name: 'Expected Duration' }),
    ).toBeInTheDocument();
  });

  it('renders three editable fields when editing', () => {
    renderSection({ isEditing: true });
    expect(screen.getByLabelText('Expected Duration')).toBeInTheDocument();
    expect(screen.getByLabelText('Expected Return Date')).toBeInTheDocument();
    expect(screen.getByLabelText('Conditions')).toBeInTheDocument();
  });

  it('forwards expected_duration changes', () => {
    const updateField = vi.fn();
    renderSection({ isEditing: true, updateField });
    fireEvent.change(screen.getByLabelText('Expected Duration'), {
      target: { value: '1_year' },
    });
    expect(updateField).toHaveBeenCalledWith('expected_duration', '1_year');
  });

  it('forwards expected_return_date changes', () => {
    const updateField = vi.fn();
    renderSection({ isEditing: true, updateField });
    fireEvent.change(screen.getByLabelText('Expected Return Date'), {
      target: { value: '2025-06-15' },
    });
    expect(updateField).toHaveBeenCalledWith(
      'expected_return_date',
      '2025-06-15',
    );
  });

  it('forwards conditions textarea changes', () => {
    const updateField = vi.fn();
    renderSection({ isEditing: true, updateField });
    fireEvent.change(screen.getByLabelText('Conditions'), {
      target: { value: 'New conditions' },
    });
    expect(updateField).toHaveBeenCalledWith('conditions', 'New conditions');
  });

  it('passes the conditions field through the isRestricted check', () => {
    const isRestricted = vi.fn().mockReturnValue(false);
    renderSection({ isEditing: true, isRestricted });
    expect(isRestricted).toHaveBeenCalledWith('special_conditions');
  });

  it('hides content when collapsed', () => {
    renderSection({ isExpanded: false });
    expect(screen.queryByLabelText('Conditions')).not.toBeInTheDocument();
  });
});
