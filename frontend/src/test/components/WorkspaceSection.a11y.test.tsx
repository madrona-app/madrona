import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { WorkspaceSection } from '../../components/workspace/WorkspaceSection';
import { checkA11y, formatViolations } from '../a11y';

vi.mock('../../components/record-detail/ActiveSectionContext', () => ({
  useActiveSection: () => ({ activeSection: null, setActiveSection: vi.fn() }),
}));

vi.mock('../../lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

function EditableContent() {
  return (
    <div>
      <label htmlFor="ws-a11y-title">Title</label>
      <input id="ws-a11y-title" defaultValue="Sunflowers" />
      <button type="button">Save</button>
    </div>
  );
}

function ToggleHarness() {
  const [expanded, setExpanded] = useState(false);
  return (
    <WorkspaceSection
      id="identification"
      title="Identification"
      badge="3"
      isExpanded={expanded}
      onToggle={() => setExpanded((v) => !v)}
      onEdit={vi.fn()}
    >
      <p>Oil on canvas</p>
    </WorkspaceSection>
  );
}

describe('WorkspaceSection accessibility', () => {
  it('collapsed: heading wraps a disclosure button with aria-expanded=false', async () => {
    const { container } = render(
      <WorkspaceSection id="desc" title="Description" isExpanded={false} onToggle={vi.fn()} hint="2 fields">
        <p>Body</p>
      </WorkspaceSection>
    );
    const heading = screen.getByRole('heading', { level: 2, name: /Description/ });
    const button = screen.getByRole('button', { name: /Description/ });
    expect(heading).toContainElement(button);
    expect(button).toHaveAttribute('aria-expanded', 'false');
    const results = await checkA11y(container);
    expect(results.violations, formatViolations(results)).toEqual([]);
  });

  it('expanded in view mode: aria-controls points at the content, Edit button available', async () => {
    const onEdit = vi.fn();
    const { container } = render(
      <WorkspaceSection id="desc" title="Description" isExpanded onToggle={vi.fn()} onEdit={onEdit}>
        <p>Body text</p>
      </WorkspaceSection>
    );
    const header = screen.getByRole('button', { name: /Description/, expanded: true });
    const controls = header.getAttribute('aria-controls');
    expect(controls).toBeTruthy();
    expect(container.querySelector(`#${controls}`)).toHaveTextContent('Body text');
    fireEvent.click(screen.getByRole('button', { name: 'Edit Description' }));
    expect(onEdit).toHaveBeenCalled();
    const results = await checkA11y(container);
    expect(results.violations, formatViolations(results)).toEqual([]);
  });

  it('expanded in edit mode with form controls has no axe violations', async () => {
    const { container } = render(
      <WorkspaceSection id="ident" title="Identification" isExpanded isEditing hasChanges onToggle={vi.fn()}>
        <EditableContent />
      </WorkspaceSection>
    );
    expect(screen.queryByRole('button', { name: /^Edit Identification$/ })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Title' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Identification/, expanded: true })).toHaveAccessibleName(
      /Unsaved changes/
    );
    const results = await checkA11y(container);
    expect(results.violations, formatViolations(results)).toEqual([]);
  });

  it('keeps keyboard focus on the header when it expands and collapses', async () => {
    render(<ToggleHarness />);
    const collapsed = screen.getByRole('button', { name: /Identification/, expanded: false });
    collapsed.focus();
    fireEvent.click(collapsed);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Identification/, expanded: true })).toHaveFocus()
    );
    fireEvent.click(screen.getByRole('button', { name: /Identification/, expanded: true }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Identification/, expanded: false })).toHaveFocus()
    );
  });
});
