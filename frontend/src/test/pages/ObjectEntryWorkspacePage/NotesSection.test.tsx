import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { createWorkspaceStubs } from './_workspaceStubs';

vi.mock('../../../components/workspace', () => createWorkspaceStubs());

import { NotesSection } from '../../../pages/collections/ObjectEntryWorkspacePage/NotesSection';
import type { EntryFormData } from '../../../pages/collections/ObjectEntryWorkspacePage/types';

const FORM = { entry_note: 'Existing note' } as unknown as EntryFormData;

function renderSection(props: Partial<Parameters<typeof NotesSection>[0]> = {}) {
  return render(
    <NotesSection
      formData={FORM}
      updateField={vi.fn()}
      isExpanded
      onToggle={vi.fn()}
      isEditing={false}
      isCreateMode={false}
      getSectionOrder={() => 5}
      {...props}
    />,
  );
}

describe('NotesSection', () => {
  it('renders the Notes title', () => {
    renderSection();
    expect(screen.getByRole('button', { name: 'Notes' })).toBeInTheDocument();
  });

  it('renders the existing entry note in view mode', () => {
    renderSection();
    expect(screen.getByTestId('view-Entry Notes')).toHaveTextContent(
      'Existing note',
    );
  });

  it('renders a textarea in edit mode', () => {
    renderSection({ isEditing: true });
    const textarea = screen.getByLabelText('Entry Notes');
    expect(textarea.tagName).toBe('TEXTAREA');
  });

  it('forwards changes through updateField', () => {
    const updateField = vi.fn();
    renderSection({ isEditing: true, updateField });
    fireEvent.change(screen.getByLabelText('Entry Notes'), {
      target: { value: 'Updated note text' },
    });
    expect(updateField).toHaveBeenCalledWith('entry_note', 'Updated note text');
  });

  it('toggles via the section header button', () => {
    const onToggle = vi.fn();
    renderSection({ onToggle });
    fireEvent.click(screen.getByRole('button', { name: 'Notes' }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('hides content when collapsed', () => {
    renderSection({ isExpanded: false });
    expect(screen.queryByTestId('view-Entry Notes')).not.toBeInTheDocument();
  });
});
