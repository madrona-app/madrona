import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { createWorkspaceStubs } from './_workspaceStubs';

vi.mock('../../../components/workspace', () => createWorkspaceStubs());

import { InsuranceSection } from '../../../pages/collections/ObjectEntryWorkspacePage/InsuranceSection';
import type { EntryFormData } from '../../../pages/collections/ObjectEntryWorkspacePage/types';

const FORM = {
  insurance_value: '2500',
  insurance_currency: 'EUR',
  insurance_note: 'Covered by depositor',
} as unknown as EntryFormData;

const CURRENCY_OPTIONS = [
  { value: 'USD', label: 'USD' },
  { value: 'EUR', label: 'EUR' },
  { value: 'GBP', label: 'GBP' },
];

function renderSection(
  props: Partial<Parameters<typeof InsuranceSection>[0]> = {},
) {
  return render(
    <InsuranceSection
      formData={FORM}
      updateField={vi.fn()}
      isExpanded
      onToggle={vi.fn()}
      isEditing={false}
      isCreateMode={false}
      getSectionOrder={() => 0}
      currencyOptions={CURRENCY_OPTIONS}
      isRestricted={() => false}
      {...props}
    />,
  );
}

describe('InsuranceSection', () => {
  it('renders the Insurance title', () => {
    renderSection();
    expect(
      screen.getByRole('button', { name: 'Insurance' }),
    ).toBeInTheDocument();
  });

  it('passes insurance_value through isRestricted gating', () => {
    const isRestricted = vi.fn().mockReturnValue(false);
    renderSection({ isEditing: true, isRestricted });
    expect(isRestricted).toHaveBeenCalledWith('insurance_value');
  });

  it('renders all three insurance fields when editing', () => {
    renderSection({ isEditing: true });
    expect(screen.getByLabelText('Insurance Value')).toBeInTheDocument();
    expect(screen.getByLabelText('Currency')).toBeInTheDocument();
    expect(screen.getByLabelText('Insurance Note')).toBeInTheDocument();
  });

  it('forwards insurance_value changes (string preserved)', () => {
    const updateField = vi.fn();
    renderSection({ isEditing: true, updateField });
    fireEvent.change(screen.getByLabelText('Insurance Value'), {
      target: { value: '9999' },
    });
    expect(updateField).toHaveBeenCalledWith('insurance_value', '9999');
  });

  it('forwards currency changes', () => {
    const updateField = vi.fn();
    renderSection({ isEditing: true, updateField });
    fireEvent.change(screen.getByLabelText('Currency'), {
      target: { value: 'GBP' },
    });
    expect(updateField).toHaveBeenCalledWith('insurance_currency', 'GBP');
  });

  it('forwards insurance_note changes', () => {
    const updateField = vi.fn();
    renderSection({ isEditing: true, updateField });
    fireEvent.change(screen.getByLabelText('Insurance Note'), {
      target: { value: 'New note' },
    });
    expect(updateField).toHaveBeenCalledWith('insurance_note', 'New note');
  });
});
